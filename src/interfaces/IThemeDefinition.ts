import { Theme } from '../enums/Theme';

export interface IThemeDefinition {
    readonly name: Theme;
    readonly label: string;
    readonly isDark: boolean;
    readonly tokens: Readonly<Record<string, string>>;
    readonly colorMap: Readonly<Record<string, string>>;
}
