/* ====================================================================
   RT-Lab 共有スクリプト
   - Cookieレス アクセス解析の注入（トークン未設定なら無効）
   - 全ページ共通の「応援フッター帯」を注入
   - ツールページに「ツール要望フォーム」への1行を注入
   既存ページのインライン<script>とは独立。グローバルを汚さないIIFE。
   ==================================================================== */
(function () {
  "use strict";

  // ===== 設定：値が用意でき次第ここを埋める（空のままなら各機能は無効） =====
  var CONFIG = {
    // Cloudflare Web Analytics のトークン（Cookieなし・IP非保存）。空文字 = 解析オフ
    cfAnalyticsToken: "f020587134574ebab5e0ca5f8068a12b",
    // ツール要望フォーム（Google フォーム）の回答用URL。空文字 = 要望の1行を出さない
    toolRequestFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLSe8YNkJZz-g1M8rzKPFgclE0DpwxTRcYGk2LL2lfu3BVtXNdg/viewform"
  };

  // ---- Cookieレス アクセス解析 ----
  if (CONFIG.cfAnalyticsToken) {
    var beacon = document.createElement("script");
    beacon.defer = true;
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
    beacon.setAttribute(
      "data-cf-beacon",
      JSON.stringify({ token: CONFIG.cfAnalyticsToken })
    );
    document.head.appendChild(beacon);
  }

  // ---- 共通：応援フッター帯 ----
  function injectSupportRow() {
    if (document.querySelector(".rt-support-row")) return;
    var row = document.createElement("div");
    row.className = "rt-support-row";
    row.innerHTML =
      '<p class="rt-foot-note">RT-Lab は個人の放射線技師が運営する無料・広告なしのツール集です。' +
      "運営継続のため、書籍紹介・投げ銭でのご支援を受け付けています。 " +
      '<a class="rt-foot-cta" href="/support/">応援方法はこちら →</a></p>' +
      '<nav class="rt-foot-nav">' +
      '<a href="/">トップ</a>' +
      '<a href="/about/">サイトについて</a>' +
      '<a href="/privacy/">プライバシー</a>' +
      '<a href="/contact/">お問い合わせ</a>' +
      '<a href="/support/">応援する</a>' +
      "</nav>";
    document.body.appendChild(row);
  }

  // ---- ツールページ：「関連ツール」の直後に要望フォームへの1行 ----
  // 「関連ツール」ブロック（.rt-related）があるページ＝ツールページだけに出す
  function injectToolRequest() {
    if (!CONFIG.toolRequestFormUrl) return;
    var anchor = document.querySelector(".rt-related");
    if (!anchor || document.querySelector(".rt-request")) return;
    var box = document.createElement("aside");
    box.className = "rt-request";
    box.innerHTML =
      '<p>ほしい計算・確認ツールはありますか？ ' +
      '<a href="' + CONFIG.toolRequestFormUrl + '" target="_blank" rel="noopener">要望を送る（2分・ログイン不要）→</a></p>' +
      '<p class="rt-request-note">患者さんの情報・院内の資料・施設名は書かないでください。</p>';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  function init() {
    injectToolRequest();
    injectSupportRow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
