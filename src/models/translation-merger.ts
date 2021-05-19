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

    this.registerCommandHandler('i18n-fix', async () => {
      const moduleType = await this.configurationService.getGahModuleType();
      if (moduleType === GahModuleType.MODULE || GahModuleType.UNKNOWN) {
        this.loggerService.error('This command can only be executed in gah host folders');
        return false;
      }
      await this.fixTranslationMismatch();
      return true;
    });

    this.registerCommandHandler('i18n-sort', async () => {
      const moduleType = await this.configurationService.getGahModuleType();
      if (moduleType === GahModuleType.MODULE || GahModuleType.UNKNOWN) {
        this.loggerService.error('This command can only be executed in gah host folders');
        return false;
      }
      await this.sortTranslationsInFiles();
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

    const destinationPath = this.fileSystemService.join('.gah', this.cfg.destinationPath);

    const translationCollection = await this.readTranslations(destinationPath);
    if (!translationCollection) {
      return false;
    }

    const mergedTranslationCollection = this.mergeTranslationCollectionsByLocale(translationCollection);

    let foundMismatch = false;
    this.findMismatches(mergedTranslationCollection, (missingKey, tc_existing, tc_missing) => {
      const msg = `Translation key '${missingKey.join('.')}' is missing from locale '${
        tc_missing.locale
      }' but present in locale '${this.formatPath(tc_existing.locale)}' with value '${this.getValueForKey(
        missingKey,
        tc_existing
      )}'`;
      if (this.cfg.translationMismatchReport === 'error') {
        this.loggerService.error(msg);
        foundMismatch = true;
      } else if (this.cfg.translationMismatchReport === 'off') {
        this.loggerService.debug(msg);
      } else {
        this.loggerService.warn(msg);
      }
    });
    if (foundMismatch) {
      return false;
    }

    await this.fileSystemService.ensureDirectory(destinationPath);

    const savePromises = mergedTranslationCollection.map(x => {
      const filePath = this.fileSystemService.join(destinationPath, `${x.locale}.json`);
      return this.fileSystemService.saveObjectToFile(filePath, x.translations, true);
    });
    await Promise.all(savePromises);
    this.loggerService.success('Translation files merged successfully!');

    return true;
  }

  private mergeTranslationCollectionsByLocale(translationCollection: TranslationCollection[]) {
    const mergedTranslationCollection = new Array<TranslationCollection>();
    translationCollection.forEach(tC => {
      let localeAlreadyKnown = false;
      let target = mergedTranslationCollection.find(x => x.locale === tC.locale);
      if (target) {
        localeAlreadyKnown = true;
      }
      target ??= { locale: tC.locale, translations: {} };
      if (tC.prefix) {
        target.translations[tC.prefix] = tC.translations;
      } else {
        target.translations = { ...target.translations, ...tC.translations };
      }
      if (!localeAlreadyKnown) {
        mergedTranslationCollection.push(target);
      }
    });
    return mergedTranslationCollection;
  }

  private async readTranslations(destinationPath: string) {
    const allTranslationFiles = await this.fileSystemService.getFilesFromGlob(
      `.gah/${this.cfg.searchGlobPattern}`,
      ['node_modules'],
      true
    );

    this.loggerService.debug(`Found translation files:${allTranslationFiles.join(', ')}`);

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
          return undefined;
        }
        locale = localeMatch[1];

        if (this.cfg.prefixRegexPattern) {
          const prefixRegex = new RegExp(this.cfg.prefixRegexPattern);
          const prefixMatch = path.basename(file).match(prefixRegex);
          if (!prefixMatch || !prefixMatch?.[1]) {
            this.loggerService.error(`The prefix matcher did not find the prefix in the filename: ${path.basename(file)}`);
            return undefined;
          }
          prefix = prefixMatch[1];
        }
      } else {
        locale = path.basename(file).replace(/\.json$/, '');
      }

      this.loggerService.debug(`Found locale: "${locale}" for: "${file}"`);

      const content = await this.fileSystemService.readFile(file);
      const trans = new TranslationCollection();
      trans.locale = locale;
      trans.path = file;
      translationCollection.push(trans);

      const parsedContent = JSON.parse(content);
      trans.prefix = prefix;
      trans.translations = parsedContent;
    }
    return translationCollection;
  }

  private findMismatches(
    translationCollection: TranslationCollection[],
    handleMissingKey: (missingKey: string[], tc_existing: TranslationCollection, tc_missing: TranslationCollection) => void
  ) {
    translationCollection.forEach(tC => {
      translationCollection.forEach(tC2 => {
        if (tC !== tC2) {
          const missingKeys = this.getKeysMismatch(tC.translations, tC2.translations);
          missingKeys.forEach(missingKey => {
            handleMissingKey(missingKey, tC, tC2);
          });
        }
      });
    });
  }

  private getKeysMismatch(obj1: object, obj2: object, path: string[] = [], res: string[][] = []) {
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
      this.getKeysMismatch(
        subObjects1.find(x => x.key === keyInObj)!.objs,
        subObjects2.find(x => x.key === keyInObj)!.objs,
        path,
        res
      );
      path.pop();
    }

    return res;
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

  private async fixTranslationMismatch() {
    const destinationPath = this.fileSystemService.join('.gah', this.cfg.destinationPath);

    const translationCollection = await this.readTranslations(destinationPath);
    if (!translationCollection) {
      return false;
    }

    const mergedTranslationCollections = this.matchTranslationCollectionsByPath(translationCollection);

    for (const mergedTranslationCollection of mergedTranslationCollections) {
      this.findMismatches(mergedTranslationCollection, (missingKey, tc_existing, tc_missing) => {
        let missingObj = tc_missing.translations;
        for (let i = 0; i < missingKey.length; i++) {
          const keySegment = missingKey[i];
          missingObj[keySegment] ??= {};
          if (i === missingKey.length - 1) {
            missingObj[keySegment] = `### MISSING TRANSLATION: '${missingKey.join('.')}' ###`;
          } else {
            missingObj = missingObj[keySegment];
          }
        }
      });

      for (const tC of mergedTranslationCollection) {
        const sortedTranslations = this.sortObjectByKeys(tC.translations);
        await this.fileSystemService.saveObjectToFile(tC.path!, sortedTranslations);
      }
    }
  }
  matchTranslationCollectionsByPath(translationCollection: TranslationCollection[]): TranslationCollection[][] {
    const r = new Array<TranslationCollection[]>();

    translationCollection.forEach(tC => {
      const f = r.find(x => x.some(y => y.path === tC.path));
      if (f) {
        f.push(tC);
      } else {
        r.push([tC]);
      }
    });

    return r;
  }

  private async sortTranslationsInFiles() {
    const destinationPath = this.fileSystemService.join('.gah', this.cfg.destinationPath);

    const translationCollection = await this.readTranslations(destinationPath);
    if (!translationCollection) {
      return false;
    }

    for (const tC of translationCollection) {
      const sortedTranslations = this.sortObjectByKeys(tC.translations);
      await this.fileSystemService.saveObjectToFile(tC.path!, sortedTranslations);
    }
  }

  private sortObjectByKeys(obj: any) {
    const objCopy = JSON.parse(JSON.stringify(obj));
    const keys = Object.keys(objCopy);
    keys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const newObj: any = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof objCopy[key] === 'object') {
        newObj[key] = this.sortObjectByKeys(objCopy[key]);
      } else {
        newObj[key] = objCopy[key];
      }
    }
    return newObj;
  }
}
