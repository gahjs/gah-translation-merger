import path from 'path';

import { GahPlugin, GahEvent, GahPluginConfig } from '@awdware/gah';

import { TranslationManagerConfig } from './translation-manager-config';
import { TranslationCollection } from './translation-collection';

export class TranslationMerger extends GahPlugin {

  protected async onInstall(existingCfg: TranslationManagerConfig): Promise<GahPluginConfig> {
    const newCfg = new TranslationManagerConfig();

    newCfg.searchGlobPattern = await this.promptService.input({
      msg: 'Please enter a globbing path to the json translation files (eg. src/assets/**/translations/*.json)',
      enabled: () => !existingCfg.searchGlobPattern,
      cancelled: false,
      validator: (val: string) => val.endsWith('.json')
    }) ?? existingCfg.searchGlobPattern;
    newCfg.destinationPath = await this.promptService.input({
      msg: 'Please enter the destination path for the merged translation files (eg src/assets/i18n)',
      enabled: () => !existingCfg.destinationPath,
      cancelled: false
    }) ?? existingCfg.destinationPath;

    return newCfg;
  }

  onInit() {
    this.registerEventListener('TranslationMerger', GahEvent.INSTALL_FINISHED, () => {
      const cfg = this.config as TranslationManagerConfig;

      if (!cfg)
        throw new Error('Plugin settings have not been provided.');

      if (!cfg.searchGlobPattern)
        throw new Error('Missing Setting: searchGlobPattern');
      if (!cfg.destinationPath)
        throw new Error('Missing Setting: destinationPath');

      const allTranslationFiles = this.fileSystemService.getFilesFromGlob(cfg.searchGlobPattern);

      const translationCollection = new Array<TranslationCollection>();

      allTranslationFiles.forEach(x => {
        const local = path.basename(x);
        const content = this.fileSystemService.readFile(x);
        let trans = translationCollection.find(x => x.local === local);
        if (!trans) {
          trans = new TranslationCollection();
          trans.local = local;
          translationCollection.push(trans);
        }
        const parsedContent = JSON.parse(content);
        trans.translations = { ...trans.translations, ...parsedContent };
      });

      this.fileSystemService.ensureDirectory(cfg.destinationPath);

      translationCollection.forEach(x => {
        const filePath = path.join(cfg.destinationPath, x.local);
        this.fileSystemService.saveObjectToFile(filePath, x.translations, true);
      });
    });
  }
}
