import tsBasics from '@kilcekru/ts-basics'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

export default tsBasics.defineConfig([
  ...tsBasics.presets.base,
  eslintPluginPrettierRecommended,
  {
    ignores: ['dist/*', '/.expo', '/.turbo', 'node_modules'],
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }]
    }
  }
])
