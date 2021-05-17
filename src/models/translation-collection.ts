export class TranslationCollection {
  public locale: string;
  public translations: any;
  public path?: string;

  constructor() {
    this.translations = {};
  }
}
