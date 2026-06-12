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
    /**
     * 固定扩展 ID(通过拖拽 zip 安装时保持 ID 不变)
     * Chrome 接受 base64 编码的 16 字节随机串,一旦设定,所有 chrome.storage.local 数据
     * (WebDAV 加密配置、settings、ignoreList 等) 在重新安装后仍然保留
     *
     * 本 key 派生自扩展 ID `hpgicjhhchdmnkandnlilgpnhgpcnkbm` (前 16 字节的 hex 解码后 base64 编码),
     * 更换 key 会让所有用户数据失效,务必保留。
     */
    key: 'AAAMAAwNAAoNAAAAAAAACw==',
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
