// クラウド同期・ログインの設定（Firebase）。
// ここの値は公開されても問題ない（データはセキュリティルールでログイン本人だけに制限）。
// 手順は README の「クラウド同期の設定」を参照。
window.OSAIFU_FIREBASE = {
  apiKey: 'AIzaSyC-y3NMZR6aKu7PVQ_4ZCcQ6Hw8cdXCkMY',
  authDomain: 'osaifu-84ac9.firebaseapp.com',
  projectId: 'osaifu-84ac9',
  storageBucket: 'osaifu-84ac9.firebasestorage.app',
  messagingSenderId: '1055910034600',
  appId: '1:1055910034600:web:b500a23b04b5374c2e169d',
};

// true にすると、ログインしないと使えなくなる（既定は「ログインせずに使う」を選べる）
window.OSAIFU_REQUIRE_LOGIN = false;
