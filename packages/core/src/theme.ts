export type ThemeId = 'archive-terminal' | 'warm-system' | 'quiet-dark' | 'paper-editorial'

export interface ThemeTokens {
  background: string
  surface: string
  text: string
  secondary: string
  tertiary: string
  line: string
  accent: string
  accentSoft: string
  success: string
  warning: string
  error: string
  info: string
  radius: string
  shadow: string
  font: string
  headingWeight: string
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  tokens: ThemeTokens
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  'archive-terminal': {
    id: 'archive-terminal', name: 'Archive Terminal', description: '低饱和档案终端与系统菜单感',
    tokens: {
      background: '#CAC8B7', surface: '#D8D6C5', text: '#2B2C27', secondary: '#5F5E55', tertiary: '#999687', line: '#9A998B', accent: '#35352F', accentSoft: '#B5B2A2', success: '#667866', warning: '#8A806E', error: '#795852', info: '#626F78', radius: '2px', shadow: 'none', font: "'IBM Plex Sans', 'Noto Sans SC', system-ui, sans-serif", headingWeight: '500',
    },
  },
  'warm-system': {
    id: 'warm-system', name: 'Warm System', description: '温暖、精确、安静的系统工作台',
    tokens: {
      background: '#F5F3EE', surface: '#FAF9F6', text: '#1C1C1A', secondary: '#77756F', tertiary: '#A6A39B', line: '#DDDAD2', accent: '#E87532', accentSoft: '#FFF1E5', success: '#6F8B72', warning: '#B08A52', error: '#A86458', info: '#71869A', radius: '5px', shadow: 'none', font: "'IBM Plex Sans SC', 'PingFang SC', system-ui, sans-serif", headingWeight: '600',
    },
  },
  'quiet-dark': {
    id: 'quiet-dark', name: 'Quiet Dark', description: '适合夜间使用的低刺激深色工作台',
    tokens: {
      background: '#20211F', surface: '#282A27', text: '#EEECE5', secondary: '#B7B5AC', tertiary: '#85857E', line: '#41433E', accent: '#E58A4D', accentSoft: '#352B24', success: '#8DA88D', warning: '#C2A16A', error: '#C78679', info: '#8EA5B8', radius: '5px', shadow: 'none', font: "'IBM Plex Sans SC', 'PingFang SC', system-ui, sans-serif", headingWeight: '500',
    },
  },
  'paper-editorial': {
    id: 'paper-editorial', name: 'Paper Editorial', description: '更有纸张和编辑排版感的个人工作台',
    tokens: {
      background: '#EDE8DE', surface: '#F8F4EB', text: '#29251F', secondary: '#756D61', tertiary: '#A59B8D', line: '#D2C8B8', accent: '#B9653B', accentSoft: '#F2E0D4', success: '#71846C', warning: '#A98752', error: '#A66658', info: '#718291', radius: '2px', shadow: 'none', font: "Georgia, 'Songti SC', serif", headingWeight: '600',
    },
  },
}

export const themeIds: ThemeId[] = ['archive-terminal', 'warm-system', 'quiet-dark', 'paper-editorial']
export const defaultTheme: ThemeDefinition = themes['archive-terminal']
export function getTheme(id: ThemeId | string | undefined): ThemeDefinition { return id && id in themes ? themes[id as ThemeId] : defaultTheme }
