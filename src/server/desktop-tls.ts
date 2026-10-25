import 'reflect-metadata';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import { BasicConstraintsExtension, ExtendedKeyUsage, ExtendedKeyUsageExtension, KeyUsageFlags, KeyUsagesExtension, SubjectAlternativeNameExtension, X509CertificateGenerator } from '@peculiar/x509';

const DIRECTORY = 'desktop-tls';
const MAX_FILE_BYTES = 16_384;
export interface DesktopTlsIdentity { key: string; cert: string; pinDER: Buffer }
const failure = () => new Error('Desktop TLS identity is missing, invalid or not private. Stop the owning service and repair its local identity before retrying; it is never replaced from a network response.');

async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw failure();
}
async function readPrivate(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.nlink !== 1 || info.size < 1 || info.size > MAX_FILE_BYTES) throw failure();
    // Bounded even if the file changes while open; never use an unbounded readFile.
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead < 1 || bytesRead > MAX_FILE_BYTES) throw failure();
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}
async function writePrivate(path: string, value: string | Buffer): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
async function readIdentity(directory: string): Promise<DesktopTlsIdentity> {
  const [keyBytes, certBytes, pinDER] = await Promise.all(['key.pem', 'cert.pem', 'pin.der'].map(name => readPrivate(join(directory, name))));
  const key = keyBytes!.toString('utf8'), cert = certBytes!.toString('utf8');
  const parsed = new X509Certificate(cert), privateKey = createPrivateKey(key);
  const now = Date.now();
  if (!parsed.raw.equals(pinDER!) || !parsed.verify(parsed.publicKey) || parsed.checkIP('127.0.0.1') !== '127.0.0.1' ||
      new Date(parsed.validFrom).getTime() > now || new Date(parsed.validTo).getTime() <= now ||
      !createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(parsed.publicKey.export({ type: 'spki', format: 'der' }))) throw failure();
  return { key, cert, pinDER: pinDER! };
}

/** Only the bundled local process creates this identity; native clients never trust a network-supplied pin. */
export async function ensureDesktopTls(dataDir: string): Promise<DesktopTlsIdentity> {
  await privateDirectory(dataDir);
  const directory = join(dataDir, DIRECTORY);
  let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  if (created) {
    const keys = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const certificate = await X509CertificateGenerator.createSelfSigned({
      serialNumber: randomBytes(16).toString('hex'), name: 'CN=Figma Semantic Bridge Local Desktop',
      notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 365 * 86_400_000),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' }, keys,
      extensions: [new BasicConstraintsExtension(false, undefined, true), new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]), new SubjectAlternativeNameExtension([{ type: 'ip', value: '127.0.0.1' }])],
    }, globalThis.crypto);
    const privateKey = createPrivateKey({ key: Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8' });
    await writePrivate(join(directory, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writePrivate(join(directory, 'cert.pem'), certificate.toString('pem'));
    await writePrivate(join(directory, 'pin.der'), Buffer.from(certificate.rawData));
  }
  return readIdentity(directory);
}
