import { Theme } from '../enums/Theme';
import { IThemeDefinition } from '../interfaces/IThemeDefinition';
import { DarkTheme } from './DarkTheme';
import { HighContrastTheme } from './HighContrastTheme';
import { LightTheme } from './LightTheme';
import { SepiaTheme } from './SepiaTheme';

export const THEME_DEFINITIONS: Record<Theme, IThemeDefinition> = {
    [Theme.SYSTEM]: {
        ...LightTheme,
        name: Theme.SYSTEM,
        label: 'System (Auto)',
    },
    [Theme.LIGHT]: LightTheme,
    [Theme.DARK]: DarkTheme,
    [Theme.SEPIA]: SepiaTheme,
    [Theme.HIGH_CONTRAST]: HighContrastTheme,
};

export function getThemeDefinition(theme: Theme): IThemeDefinition {
    return THEME_DEFINITIONS[theme] || LightTheme;
}
