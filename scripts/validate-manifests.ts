import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export async function loadManifestValidator() {
  const schema: object = JSON.parse(await readFile(resolve(repositoryRoot, 'fixtures/manifest.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  // ajv-formats' CommonJS callable is exposed as the default at runtime.
  (addFormats as unknown as (instance: Ajv) => void)(ajv);
  return ajv.compile(schema);
}

/** Cross-field provenance checks beyond JSON Schema's structural validation. */
export function manifestConsistencyErrors(value: unknown): string[] {
  const data = value as { fixtures: Array<{
    id: string;
    source: { kind: string; url: string; fileKey: string | null; communityResourceId: string | null };
    qualitative: Array<{ dimension: string }>;
  }> };
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const fixture of data.fixtures) {
    if (ids.has(fixture.id)) errors.push(`Duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    const source = fixture.source;
    const segments = new URL(source.url).pathname.split('/');
    const urlIdentifier = segments[source.kind === 'community' ? 3 : 2];
    const expectedIdentifier = source.kind === 'community' ? source.communityResourceId : source.fileKey;
    if (urlIdentifier !== expectedIdentifier) errors.push(`${fixture.id}: URL identity differs from source identifier`);
    if (new Set(fixture.qualitative.map(item => item.dimension)).size !== 5) {
      errors.push(`${fixture.id}: qualitative dimensions must each occur once`);
    }
  }
  return errors;
}

export async function validateManifests(paths = ['fixtures/public/manifest.json', 'fixtures/synthetic/manifest.json']) {
  const validate = await loadManifestValidator();
  for (const path of paths) {
    const data: unknown = JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8'));
    if (!validate(data)) throw new Error(`${path}: ${JSON.stringify(validate.errors)}`);
    const errors = manifestConsistencyErrors(data);
    if (errors.length > 0) throw new Error(`${path}: ${errors.join('; ')}`);
  }
  return paths.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await validateManifests();
  console.log(`Validated ${count} fixture manifests (schema and provenance consistency).`);
}
