import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // ─── 架构边界规则（防退化） ───
      'no-restricted-imports': 'off',
    },
  },
  // config/ 目录强制执行叶子模块规则
  {
    files: ['src/config/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../core/*', '../core/**/*'],
            message: '⛔ config/ 是纯叶子模块，禁止依赖 core/。使用 console.warn 代替 logger。',
          },
          {
            group: ['../memoryStorage/*', '../memoryStorage/**/*'],
            message: '⛔ config/ 禁止依赖 memoryStorage/。将组合逻辑移到消费方。',
          },
        ],
      }],
    },
  },
  // core/ 目录禁止依赖 domain/、memoryStorage/、prompts/
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../domain/*', '../domain/**/*', '../../domain/*', '../../domain/**/*'],
            message: '⛔ core/ 基础设施层禁止依赖 domain/ 业务层。使用依赖注入。',
          },
          {
            group: ['../memoryStorage/*', '../../memoryStorage/*'],
            message: '⛔ core/ 禁止依赖 memoryStorage/。',
          },
          {
            group: ['../prompts/*', '../../prompts/*'],
            message: '⛔ core/ 禁止依赖 prompts/。',
          },
        ],
      }],
    },
  },
  // domain/ 目录禁止从 tools/types 导入
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/tools/types', '**/tools/types.js', '**/tools/types.*'],
            message: '⛔ domain/ 禁止从 tools/types 导入。请从 core/types/tools 导入。',
          },
        ],
      }],
    },
  },
  // plugins/ 目录约束：胶水层只连接 core 和 domain，不引入新业务逻辑
  {
    files: ['src/plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../../tools/*', '../../tools/**/*'],
            message: '⛔ plugins/ 禁止直接依赖 tools/。通过 PluginContext.request/emit 调用工具。',
          },
        ],
      }],
    },
  },
];
