// おさいふ — お知らせデータ
// 新しいお知らせは、この配列の先頭に追加します。
// 本文は sections の paragraphs に文字列で、関連リンクは links に追加します。
window.NEWS_ITEMS = [
  {
    id: '2026-10-02-introduction',
    date: '2026-10-02',
    category: 'info',
    categoryLabel: 'アプリ紹介',
    title: '「おさいふ」のご紹介',
    summary: '毎日のお金と、これからの支払いをひとつの場所で見渡せる家計簿アプリです。',
    sections: [
      {
        heading: 'できること',
        paragraphs: [
          '収入・支出・振替を記録し、月ごとの収支や予算、口座・現金の残高を確認できます。',
          '家賃やサブスクリプションなどの定期的な支払いを登録すると、カレンダーや支払予定から確認できます。CSV入出力やJSONバックアップにも対応しています。',
        ],
      },
      {
        heading: 'データの保存について',
        paragraphs: [
          'ログインせずに使う場合、データはこの端末のブラウザに保存されます。端末の故障やブラウザデータの削除に備えて、設定から定期的にバックアップしてください。',
          'ログインすると、対応しているデータをクラウドと同期できます。',
        ],
      },
    ],
  },
];

window.NEWS_APP = {
  name: 'おさいふ',
  icon: '👛',
  appHref: './app.html',
  appLabel: 'おさいふに戻る',
  readStorageKey: 'osaifu-news-read-ids',
};
