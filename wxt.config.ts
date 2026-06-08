import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
// npm package name: totp-vault (package.json)
// manifest name: totp-vault (user-visible)
export default defineConfig({
  srcDir: 'src',
  outDir: '.output',

  manifest: {
    name: 'totp-vault',
    description: 'Password manager + TOTP authenticator, data on your WebDAV',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'totp-vault',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
