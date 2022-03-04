import { ReportType } from './translation-manager-config';

export interface MissingKeyReportSet {
  reportType: ReportType;
  details: MissingKeysDetails;
}

export interface MissingKeysDetails {
  hasMissingKeys: boolean;
  modulesWithMissingKeys: string[];
  details: { [key: string]: MissingKeysModuleDetails };
}

export interface MissingKeysModuleDetails {
  count: number;
  keysMissingInLocales: string[];
  missingKeys: MissingKeyDetails[];
}

export interface MissingKeyDetails {
  key: string;
  languagesMissing: string[];
  languagesExisting: string[];
  existingValues: string[];
}
