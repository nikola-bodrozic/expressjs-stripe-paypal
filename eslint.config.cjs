// eslint.config.cjs
module.exports = [
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        global: "readonly",
        exports: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { 
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }],
      "no-redeclare": "error",
      "no-shadow": ["error", { "hoist": "all" }],
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-multi-str": "error",
      "no-var": "error",
      "prefer-const": ["error", { "destructuring": "all" }],
      "no-console": "off",
      "semi": ["error", "always"],
      "quotes": ["error", "double", { "avoidEscape": true }]
    }
  }
];