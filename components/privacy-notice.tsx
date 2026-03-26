export function PrivacyNotice() {
  return (
    <section className="privacy-notice panel subtle-panel">
      <p className="eyebrow">利用方針</p>
      <h2>データはブラウザ内で扱います</h2>
      <p>
        RT-Lab の初回公開ツールは、アップロードした画像やCSVをサーバー保存せず、
        ローカルブラウザ内で処理する前提で設計しています。結果の履歴保存や共有機能は、
        今後の要件整理後に段階的に追加します。
      </p>
    </section>
  );
}
