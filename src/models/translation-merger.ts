import path from 'path';

import { GahModuleType, GahPlugin, GahPluginConfig } from '@gah/shared';

import { TranslationManagerConfig } from './translation-manager-config';
import { TranslationCollection } from './translation-collection';

export class TranslationMerger extends GahPlugin {
  constructor() {
    super('TranslationMerger');
  }

  public async onInstall(existingCfg: TranslationManagerConfig): Promise<GahPluginConfig> {
    const newCfg = new TranslationManagerConfig();

    newCfg.searchGlobPattern = await this.promptService.input({
      msg: 'Please enter a globbing path to the json translation files',
      default: 'src/assets/**/translations/*.json',
      enabled: () => !(existingCfg?.searchGlobPattern),
      validator: (val: string) => val.endsWith('.json')
    }) ?? existingCfg.searchGlobPattern;
    newCfg.destinationPath = await this.promptService.input({
      msg: 'Please enter the destination path for the merged translation files',
      default: 'src/assets/i18n',
      enabled: () => !(existingCfg?.destinationPath),
    }) ?? existingCfg.destinationPath;
    // .*\.(\w+)\.json
    newCfg.localeRegexPattern = await this.promptService.input({
      msg: 'Please enter a regex that has one matching group that matches the locale of the filename. leave empty for matching the whole filename'
        + ' See https://github.com/awdware/gah-translation-merger for a detailed documentation',
      default: '',
      enabled: () => !(existingCfg?.localeRegexPattern),
    }) ?? existingCfg.localeRegexPattern;
    newCfg.prefixRegexPattern = await this.promptService.input({
      msg: 'Please enter a regex that has one matching group that matches the prefix (of the final translation file) within the filename. leave empty for no prefix'
        + ' See https://github.com/awdware/gah-translation-merger for a detailed documentation',
      default: '',
      enabled: () => !(existingCfg?.prefixRegexPattern),
    }) ?? existingCfg.prefixRegexPattern;

    return newCfg;
  }

  registerCommands() {
    this.registerCommandHandler('i18n', async () => {
      const moduleType = await this.configurationService.getGahModuleType();
      if (moduleType === GahModuleType.MODULE || GahModuleType.UNKNOWN) {
        this.loggerService.error('This command can only be executed in gah host folders');
        return false;
      }
      const name = this.fileSystemService.directoryName(process.cwd());
      this.mergeTranslations(name);
      return true;
    });
  }

  public onInit() {
    this.registerCommands();
    this.registerEventListener('AFTER_COPY_ASSETS', async (event) => {
      if (!event.module?.isHost) {
        return;
      }
      const name = this.fileSystemService.directoryName(event.module.basePath);
      await this.mergeTranslations(name);
    });
  }

  private async mergeTranslations(name: string | undefined) {
    this.loggerService.log(`Merging translation files for ${name}`);

    const cfg = this.config as TranslationManagerConfig;
    if (!cfg) { throw new Error('Plugin settings have not been provided.'); }

    if (!cfg.searchGlobPattern) { throw new Error('Missing Setting: searchGlobPattern'); }
    if (!cfg.destinationPath) { throw new Error('Missing Setting: destinationPath'); }

    const allTranslationFiles = await this.fileSystemService.getFilesFromGlob(`.gah/${cfg.searchGlobPattern}`, ['node_modules'], true);

    this.loggerService.debug(`Found translation files:${allTranslationFiles.join(', ')}`);

    const destinationPath = this.fileSystemService.join('.gah', cfg.destinationPath);
    const translationCollection = new Array<TranslationCollection>();

    const filteredTranslationFiles = allTranslationFiles.filter(x => !x.startsWith(destinationPath));
    for (const file of filteredTranslationFiles) {
      let locale: string;
      let prefix: string | undefined = undefined;
      if (cfg.localeRegexPattern) {
        const localeRegex = new RegExp(cfg.localeRegexPattern);
        const localeMatch = path.basename(file).match(localeRegex);
        if (!localeMatch || !(localeMatch?.[1])) {
          throw new Error(`The locale matcher did not find the locale in the filename: ${path.basename(file)}`);
        }
        locale = localeMatch[1];

        if (cfg.prefixRegexPattern) {
          const prefixRegex = new RegExp(cfg.prefixRegexPattern);
          const prefixMatch = path.basename(file).match(prefixRegex);
          if (!prefixMatch || !(prefixMatch?.[1])) {
            throw new Error(`The prefix matcher did not find the prefix in the filename: ${path.basename(file)}`);
          }
          prefix = prefixMatch[1];

        }

      } else {
        locale = path.basename(file).replace(/\.json$/, '');
      }

      this.loggerService.debug(`Found locale: "${locale}" for: "${file}"`);

      const content = await this.fileSystemService.readFile(file);
      let trans = translationCollection.find(x => x.locale === locale);
      if (!trans) {
        trans = new TranslationCollection();
        trans.locale = locale;
        translationCollection.push(trans);
      }
      const parsedContent = JSON.parse(content);
      if (prefix) {
        trans.translations[prefix] = parsedContent;
      } else {
        trans.translations = { ...trans.translations, ...parsedContent };
      }
    }

    await this.fileSystemService.ensureDirectory(destinationPath);

    const savePromises = translationCollection.map(x => {
      const filePath = this.fileSystemService.join(destinationPath, `${x.locale}.json`);
      return this.fileSystemService.saveObjectToFile(filePath, x.translations, true);
    });
    await Promise.all(savePromises);
    this.loggerService.success('Translation files merged successfully!');
  }
}
