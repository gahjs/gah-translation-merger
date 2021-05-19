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

    newCfg.searchGlobPattern =
      (await this.promptService.input({
        msg: 'Please enter a globbing path to the json translation files',
        default: 'src/assets/**/translations/*.json',
        enabled: () => !existingCfg?.searchGlobPattern,
        validator: (val: string) => val.endsWith('.json')
      })) ?? existingCfg.searchGlobPattern;
    newCfg.destinationPath =
      (await this.promptService.input({
        msg: 'Please enter the destination path for the merged translation files',
        default: 'src/assets/i18n',
        enabled: () => !existingCfg?.destinationPath
      })) ?? existingCfg.destinationPath;
    // .*\.(\w+)\.json
    newCfg.localeRegexPattern =
      (await this.promptService.input({
        msg:
          'Please enter a regex that has one matching group that matches the locale of the filename. leave empty for matching the whole filename' +
          ' See https://github.com/awdware/gah-translation-merger for a detailed documentation',
        default: '',
        enabled: () => !existingCfg?.localeRegexPattern
      })) ?? existingCfg.localeRegexPattern;
    newCfg.prefixRegexPattern =
      (await this.promptService.input({
        msg:
          'Please enter a regex that has one matching group that matches the prefix (of the final translation file) within the filename. leave empty for no prefix' +
          ' See https://github.com/awdware/gah-translation-merger for a detailed documentation',
        default: '',
        enabled: () => !existingCfg?.prefixRegexPattern
      })) ?? existingCfg.prefixRegexPattern;

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
    this.registerEventListener('AFTER_COPY_ASSETS', async event => {
      if (!event.module?.isHost) {
        return true;
      }
      const name = this.fileSystemService.directoryName(event.module.basePath);
      return this.mergeTranslations(name);
    });
  }

  private get cfg() {
    return this.config as TranslationManagerConfig;
  }

  private async mergeTranslations(name: string | undefined): Promise<boolean> {
    this.loggerService.log(`Merging translation files for ${name}`);

    if (!this.cfg) {
      this.loggerService.error('Plugin settings have not been provided.');
      return false;
    }

    if (!this.cfg.searchGlobPattern) {
      this.loggerService.error('Missing Setting: searchGlobPattern');
      return false;
    }
    if (!this.cfg.destinationPath) {
      this.loggerService.error('Missing Setting: destinationPath');
      return false;
    }

    const allTranslationFiles = await this.fileSystemService.getFilesFromGlob(
      `.gah/${this.cfg.searchGlobPattern}`,
      ['node_modules'],
      true
    );

    this.loggerService.debug(`Found translation files:${allTranslationFiles.join(', ')}`);

    const destinationPath = this.fileSystemService.join('.gah', this.cfg.destinationPath);
    const translationCollection = new Array<TranslationCollection>();

    const filteredTranslationFiles = allTranslationFiles.filter(x => !x.startsWith(destinationPath));
    for (const file of filteredTranslationFiles) {
      let locale: string;
      let prefix: string | undefined = undefined;
      if (this.cfg.localeRegexPattern) {
        const localeRegex = new RegExp(this.cfg.localeRegexPattern);
        const localeMatch = path.basename(file).match(localeRegex);
        if (!localeMatch || !localeMatch?.[1]) {
          this.loggerService.error(`The locale matcher did not find the locale in the filename: ${path.basename(file)}`);
          return false;
        }
        locale = localeMatch[1];

        if (this.cfg.prefixRegexPattern) {
          const prefixRegex = new RegExp(this.cfg.prefixRegexPattern);
          const prefixMatch = path.basename(file).match(prefixRegex);
          if (!prefixMatch || !prefixMatch?.[1]) {
            this.loggerService.error(`The prefix matcher did not find the prefix in the filename: ${path.basename(file)}`);
            return false;
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
        trans.path = file;
        translationCollection.push(trans);
      }
      const parsedContent = JSON.parse(content);
      if (prefix) {
        trans.translations[prefix] = parsedContent;
      } else {
        trans.translations = { ...trans.translations, ...parsedContent };
      }
    }

    const getKeysMismatch = (obj1: object, obj2: object, path: string[] = [], res: string[][] = []) => {
      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      const missingKeys = keys1.filter(x => !keys2.some(y => y === x));

      res.push(...missingKeys.filter(mK => typeof (obj1 as any)[mK] === 'string').map(mK => [...path, mK]));

      // Re-adding the missing keys to report further missing translation values down that branch
      keys2.push(...missingKeys);
      const subObjects1 = keys1
        .map(k => {
          return { objs: (obj1 as any)[k], key: k };
        })
        .filter(x => typeof x.objs === 'object');
      const subObjects2 = keys2
        .map(k => {
          return { objs: (obj2 as any)[k] ?? {}, key: k };
        })
        .filter(x => typeof x.objs === 'object');

      for (let i = 0; i < subObjects1.length; i++) {
        const keyInObj = Object.keys(obj1).find(key => (obj1 as any)[key] === subObjects1[i].objs)!;
        path.push(keyInObj);
        getKeysMismatch(
          subObjects1.find(x => x.key === keyInObj)!.objs,
          subObjects2.find(x => x.key === keyInObj)!.objs,
          path,
          res
        );
        path.pop();
      }

      return res;
    };

    let foundMismatch = false;
    translationCollection.forEach(tC => {
      translationCollection.forEach(tC2 => {
        if (tC !== tC2) {
          const missingKeys = getKeysMismatch(tC.translations, tC2.translations);
          missingKeys.forEach(missingKey => {
            const msg = `Translation key '${missingKey.join('.')}' is missing from locale '${
              tC2.locale
            }' but present in '${this.formatPath(tC.path!)}' with value '${this.getValueForKey(missingKey, tC)}'`;
            if (this.cfg.translationMismatchReport === 'error') {
              this.loggerService.error(msg);
              foundMismatch = true;
            } else if (this.cfg.translationMismatchReport === 'off') {
              this.loggerService.debug(msg);
            } else {
              this.loggerService.warn(msg);
            }
          });
        }
      });
    });
    if (foundMismatch) {
      return false;
    }

    await this.fileSystemService.ensureDirectory(destinationPath);

    const savePromises = translationCollection.map(x => {
      const filePath = this.fileSystemService.join(destinationPath, `${x.locale}.json`);
      return this.fileSystemService.saveObjectToFile(filePath, x.translations, true);
    });
    await Promise.all(savePromises);
    this.loggerService.success('Translation files merged successfully!');

    return true;
  }

  private formatPath(path: string) {
    const shortedPath = path?.replace('.gah/src/assets/', '');
    const pathSegments = shortedPath.split('/');
    const res = '[' + pathSegments.splice(0, 1)[0] + ']/' + pathSegments.join('/');
    return res;
  }

  private getValueForKey(missingKey: string[], tC: TranslationCollection) {
    let val: any = tC.translations;
    for (const keyPathSegment of missingKey) {
      val = val[keyPathSegment];
    }
    return val as string;
  }
}
