import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SettingsViewSchema, ImportSettingsSchema, defaultImportSettings, type SettingsView } from '../shared/import-settings.js';
import { ServiceError } from './errors.js';

export class ImportSettingsStore {
  private value: SettingsView = {revision:0,settings:defaultImportSettings()};
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory:string) {}
  async initialize() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try {
      const file=await open(join(this.directory,'import-settings.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
      try {const info=await file.stat();if(!info.isFile()||info.size>8192)throw new Error('Invalid settings file.');
        this.value=SettingsViewSchema.parse(JSON.parse(await file.readFile('utf8')));
      } finally {await file.close();}
    } catch(error) {if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
  }
  get():SettingsView {return structuredClone(this.value);}
  async save(revision:number,input:unknown):Promise<SettingsView> {
    const settings=ImportSettingsSchema.parse(input);
    const next=this.pending.catch(()=>{}).then(async()=>{
      if(revision!==this.value.revision)throw new ServiceError('REVISION_CONFLICT','Settings changed. Reopen settings and try again.',409);
      const value={revision:revision+1,settings},temporary=join(this.directory,`import-settings.${randomUUID()}.tmp`);
      try {
        const file=await open(temporary,'wx',0o600);
        try {await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
        await rename(temporary,join(this.directory,'import-settings.json'));this.value=value;
      } finally {await rm(temporary,{force:true});}
      return this.get();
    });this.pending=next;return next;
  }
}
