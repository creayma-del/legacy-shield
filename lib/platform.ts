import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DetectPlatformOptions, DetectPlatformResult } from './types.js';

const H5_PACKAGES = [
  'cordova',
  '@dcloudio/uni-app',
  'uni-app',
  '@tarojs/taro',
  'taro',
  '@ionic/vue',
  '@ionic/react',
  '@ionic/angular',
  'ionic',
  'phonegap',
];

const WEB_PACKAGES = ['next', 'nuxt', 'gatsby'];

export function detectPlatform(options: DetectPlatformOptions): DetectPlatformResult {
  const { projectPath, explicit } = options;

  if (explicit) {
    return {
      platform: explicit,
      context: { inferred: false, explicit: true, strategy: 'explicit' },
    };
  }

  const packageJson = readPackageJson(projectPath);
  const deps = packageJson ? { ...packageJson.dependencies, ...packageJson.devDependencies } : {};

  const h5Package = findPackage(deps, H5_PACKAGES);
  if (h5Package) {
    return {
      platform: 'h5',
      context: { inferred: true, explicit: false, strategy: 'package-h5', packageName: h5Package },
    };
  }

  const webPackage = findPackage(deps, WEB_PACKAGES);
  if (webPackage) {
    return {
      platform: 'web',
      context: { inferred: true, explicit: false, strategy: 'package-web', packageName: webPackage },
    };
  }

  if (deps['react-router-dom'] && hasWebRouting(projectPath)) {
    return {
      platform: 'web',
      context: { inferred: true, explicit: false, strategy: 'react-router-dom', packageName: 'react-router-dom' },
    };
  }

  const viewport = findEntryHtmlViewport(projectPath);
  if (viewport) {
    if (looksLikeMobileViewport(viewport)) {
      return {
        platform: 'h5',
        context: { inferred: true, explicit: false, strategy: 'viewport', viewportContent: viewport },
      };
    }
    return {
      platform: 'web',
      context: { inferred: true, explicit: false, strategy: 'viewport', viewportContent: viewport },
    };
  }

  if (existsSync(resolve(projectPath, 'manifest.json'))) {
    return {
      platform: 'web',
      context: { inferred: true, explicit: false, strategy: 'manifest' },
    };
  }

  return {
    platform: 'web',
    context: { inferred: true, explicit: false, strategy: 'default' },
  };
}

function readPackageJson(projectPath: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  try {
    const content = readFileSync(resolve(projectPath, 'package.json'), 'utf8');
    return JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  } catch {
    return null;
  }
}

function findPackage(deps: Record<string, string>, packages: string[]): string | undefined {
  for (const pkg of packages) {
    if (deps[pkg] !== undefined) return pkg;
  }
  return undefined;
}

function hasWebRouting(projectPath: string): boolean {
  const serverFiles = ['server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts'];
  for (const file of serverFiles) {
    if (existsSync(resolve(projectPath, file))) return true;
  }
  if (existsSync(resolve(projectPath, 'pages'))) return true;
  if (existsSync(resolve(projectPath, 'src', 'pages'))) return true;
  return false;
}

function findEntryHtmlViewport(projectPath: string): string | undefined {
  const candidates = ['index.html', 'public/index.html', 'src/index.html'];
  for (const candidate of candidates) {
    const fullPath = resolve(projectPath, candidate);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath, 'utf8');
      const match = content.match(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
      if (match) return match[1];
      const match2 = content.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']viewport["'][^>]*>/i);
      if (match2) return match2[1];
    } catch {
      // ignore
    }
  }
  return undefined;
}

function looksLikeMobileViewport(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes('width=device-width') && lower.includes('initial-scale');
}
