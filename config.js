// クラウド同期の設定。Firebase コンソールの「プロジェクトの設定 → マイアプリ（ウェブ）」の
// firebaseConfig をそのまま貼り付けると、設定画面に「クラウド同期」が表示される。
// ここの値は公開されても問題ない（データはセキュリティルールでログイン本人だけに制限）。
// 手順は README の「クラウド同期の設定」を参照。
window.OSAIFU_FIREBASE = null;

// true にすると、ログインしないと使えなくなる（既定は「ログインせずに使う」を選べる）
window.OSAIFU_REQUIRE_LOGIN = false;
/* 例：
window.OSAIFU_FIREBASE = {
  apiKey: '...',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  appId: '...',
};
*/
