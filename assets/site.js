/* ====================================================================
   RT-Lab 共有スクリプト
   - Cookieレス アクセス解析の注入（トークン未設定なら無効）
   - 全ページ共通の「応援フッター帯」を注入
   既存ページのインライン<script>とは独立。グローバルを汚さないIIFE。
   ==================================================================== */
(function () {
  "use strict";

  // ===== 設定：値が用意でき次第ここを埋める（空のままなら各機能は無効） =====
  var CONFIG = {
    // Cloudflare Web Analytics のトークン（Cookieなし・IP非保存）。空文字 = 解析オフ
    cfAnalyticsToken: ""
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectSupportRow);
  } else {
    injectSupportRow();
  }
})();
