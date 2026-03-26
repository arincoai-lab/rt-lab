export type ToolKey = "drl-comparison" | "mtf-calculator" | "nps-calculator";

export type ToolDefinition = {
  slug: ToolKey;
  label: string;
  shortLabel: string;
  category: string;
  status: string;
  legacyHref: string;
  description: string;
  summary: string;
  audience: string;
  input: string[];
  output: string[];
  notices: string[];
  highlights: string[];
  sampleHref?: string;
};

export const tools: ToolDefinition[] = [
  {
    slug: "drl-comparison",
    label: "DRL比較ツール",
    shortLabel: "DRL比較",
    category: "線量最適化",
    status: "公開中",
    legacyHref: "/drl-comparison",
    description:
      "CT検査データのCSVを読み込み、Japan DRLs 2025を基準にプロトコール別の線量状況を可視化します。",
    summary:
      "診断参考レベルに対して、どのプロトコールが適正か、どこが超過しているかをブラウザ内で素早く確認できます。",
    audience: "線量管理やプロトコール評価を行う放射線技師、品質管理担当者向け。",
    input: [
      "CSVアップロード: 検査日、性別、年齢、身長、体重、検査プロトコール、造影有無、CTDIvol、DLP",
      "年齢・体重の除外条件を含む既存仕様に対応",
      "固定リスト外プロトコールは警告付きでスキップ",
    ],
    output: [
      "プロトコール別の中央値集計",
      "CTDIvol / DLP の適正・超過判定",
      "集計表とチャートによる可視化",
    ],
    notices: [
      "解析はブラウザ内で完結し、アップロードデータは保存しません。",
      "年齢や体重条件に合わない行は除外されます。",
      "サンプルCSVで入力形式を事前に確認できます。",
    ],
    highlights: [
      "Japan DRLs 2025に対応",
      "CTDIvolとDLPを同時評価",
      "現場のCSV確認フローに合わせやすい構成",
    ],
    sampleHref: "/samples/rt-lab_drl_compare_testdata_ct_toolformat.csv",
  },
  {
    slug: "mtf-calculator",
    label: "MTF計算ツール",
    shortLabel: "MTF計測",
    category: "画質評価",
    status: "公開中",
    legacyHref: "/mtf-calculator",
    description:
      "Circular Edge法でMTFを算出し、ESF・LSF・MTFカーブをブラウザ上で確認できる評価ツールです。",
    summary:
      "ファントム画像を読み込むだけで、50%値・10%値を含む空間分解能評価を実務向けに整理して確認できます。",
    audience: "一般撮影やCTの画質確認、教育、試験撮影の比較を行う放射線技師向け。",
    input: [
      "DICOM / PNG / TIFF の画像ファイル",
      "エッジファントム画像",
      "ブラウザ上でのROI操作",
    ],
    output: [
      "ESF / LSF / MTF グラフ",
      "MTF 50%値・10%値",
      "画像確認用プレビュー",
    ],
    notices: [
      "解析はローカルブラウザ内で完結し、画像は外部送信されません。",
      "初回リリースでは既存ツール画面へ遷移して利用します。",
      "結果保存や履歴管理は今後の拡張候補です。",
    ],
    highlights: [
      "Circular Edge法に対応",
      "複数ファイル形式を受け付け",
      "教育用途にも使いやすい可視化",
    ],
  },
  {
    slug: "nps-calculator",
    label: "NPS計算ツール",
    shortLabel: "NPS計測",
    category: "画質評価",
    status: "公開中",
    legacyHref: "/nps-calculator",
    description:
      "DICOM画像から2D-NPSを算出し、Radial Averageを通じて1D-NPSまで確認できるノイズ評価ツールです。",
    summary:
      "ノイズ特性をブラウザ上で定量確認でき、装置比較や条件比較の基礎データづくりに役立ちます。",
    audience: "画質管理、装置比較、研究・検証を行う放射線技師向け。",
    input: [
      "DICOM画像ファイル",
      "ROIを指定したノイズ解析",
      "ブラウザ上での画像確認",
    ],
    output: [
      "2D-NPS 表示",
      "1D-NPS（Radial Average）グラフ",
      "ノイズ傾向の比較材料",
    ],
    notices: [
      "解析はブラウザ内処理で、画像データは保存しません。",
      "初回リリースでは既存ツール画面へ遷移して利用します。",
      "詳細レポート出力は今後の拡張候補です。",
    ],
    highlights: [
      "2D-NPSから1D-NPSまで確認可能",
      "研究用途にも使いやすい構成",
      "インストール不要で動作",
    ],
  },
];

export const siteHighlights = [
  {
    title: "ブラウザ完結",
    body: "インストール不要で、現場PCや検証用端末からすぐ使えます。",
  },
  {
    title: "外部送信なし",
    body: "画像やCSVはローカルブラウザ内で処理し、サーバー保存を前提にしません。",
  },
  {
    title: "現場で使える設計",
    body: "説明より実務導線を優先し、入力仕様や注意点を明示したUIでまとめます。",
  },
];

export const aboutPoints = [
  "RT-Labは、放射線技師の実務・品質管理・検証を支えるブラウザツールの公開基盤です。",
  "無料・広告なし・ローカル処理を軸に、業務で試しやすい形を大切にしています。",
  "初回リリースでは既存ツール資産を活かしつつ、今後の再設計に耐える共通UI基盤へ移行します。",
];

export function getTool(slug: string) {
  return tools.find((tool) => tool.slug === slug);
}
