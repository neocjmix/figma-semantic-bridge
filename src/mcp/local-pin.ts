import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { join } from 'node:path';

/** Filesystem trust anchor only; never learn a pin from the peer being authenticated. */
export async function readLocalCertificate(dataDir:string):Promise<Buffer> {
  for(const path of [dataDir,join(dataDir,'desktop-tls')]) {
    const info=await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw new Error('Local identity directory must be private.');
  }
  const file=await open(join(dataDir,'desktop-tls','pin.der'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();
    if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.nlink!==1||info.size<1||info.size>16384)throw new Error('Local certificate pin must be private.');
    const buffer=Buffer.alloc(16385),{bytesRead}=await file.read(buffer,0,buffer.length,0);
    if(bytesRead<1||bytesRead>16384)throw new Error('Invalid local certificate pin.');
    return buffer.subarray(0,bytesRead);
  } finally {await file.close();}
}
