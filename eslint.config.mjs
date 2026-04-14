import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			globals: {
				// Browser globals
				window: "readonly",
				document: "readonly",
				console: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				HTMLElement: "readonly",
				HTMLInputElement: "readonly",
				HTMLSelectElement: "readonly",
				HTMLTextAreaElement: "readonly",
				MouseEvent: "readonly",
				KeyboardEvent: "readonly",
				Event: "readonly",
				DragEvent: "readonly",
				ClipboardEvent: "readonly",
				MutationObserver: "readonly",
				ResizeObserver: "readonly",
				IntersectionObserver: "readonly",
				// Obsidian globals
				createDiv: "readonly",
				createEl: "readonly",
				createSpan: "readonly",
				createFragment: "readonly",
				activeDocument: "readonly",
			},
		},
		rules: {
			// Not relevant — we're not based on the sample plugin
			"obsidianmd/sample-names": "off",
			"obsidianmd/no-sample-code": "off",
			"obsidianmd/ui/sentence-case": "error",
			// Pre-existing violations — downgraded to warn so --max-warnings
			// can gate the build. Promote back to error as tickets are resolved.
			"@typescript-eslint/no-floating-promises": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-base-to-string": "warn",
		},
	},
{
		// Table columns need dynamic widths set via element.style
		files: ["src/views/table/**/*.ts"],
		rules: {
			"obsidianmd/no-static-styles-assignment": "off",
		},
	},
]);
