import path from 'path';

import { GahPlugin, GahEvent, GahPluginConfig, AssetsBaseStylesCopiedEvent } from '@awdware/gah-shared';

import { TranslationManagerConfig } from './translation-manager-config';
import { TranslationCollection } from './translation-collection';

export class TranslationMerger extends GahPlugin {
  constructor() {
    super('TranslationMerger');
  }

  protected async onInstall(existingCfg: TranslationManagerConfig): Promise<GahPluginConfig> {
    const newCfg = new TranslationManagerConfig();

    newCfg.searchGlobPattern = await this.promptService.input({
      msg: 'Please enter a globbing path to the json translation files',
      default: 'src/assets/**/translations/*.json',
      enabled: () => !(existingCfg?.searchGlobPattern),
      cancelled: false,
      validator: (val: string) => val.endsWith('.json')
    }) ?? existingCfg.searchGlobPattern;
    newCfg.destinationPath = await this.promptService.input({
      msg: 'Please enter the destination path for the merged translation files',
      default: 'src/assets/i18n',
      enabled: () => !(existingCfg?.destinationPath),
      cancelled: false
    }) ?? existingCfg.destinationPath;

    return newCfg;
  }

  onInit() {
    this.registerEventListener(GahEvent.ASSETS_BASE_STYLES_COPIED, (event: AssetsBaseStylesCopiedEvent) => {
      const name = event.module?.isHost ? this.fileSystemService.directoryName(event.module.basePath.substr(0, event.module.basePath.length - 4)) : event.module?.moduleName;

      this.loggerService.log('Merging translation files for ' + name);

      const cfg = this.config as TranslationManagerConfig;
      if (!cfg)
        throw new Error('Plugin settings have not been provided.');

      if (!cfg.searchGlobPattern)
        throw new Error('Missing Setting: searchGlobPattern');
      if (!cfg.destinationPath)
        throw new Error('Missing Setting: destinationPath');

      const allTranslationFiles = this.fileSystemService.getFilesFromGlob('.gah/' + cfg.searchGlobPattern, ['node_modules'], true);

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

      this.fileSystemService.ensureDirectory(path.join('.gah', cfg.destinationPath));

      translationCollection.forEach(x => {
        const filePath = path.join('.gah', cfg.destinationPath, x.local);
        this.fileSystemService.saveObjectToFile(filePath, x.translations, true);
      });
      this.loggerService.success('Translation files merged successfully!');
    });
  }
}
