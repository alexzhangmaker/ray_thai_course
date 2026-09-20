你是一位顶尖的教育课程设计专家与数据结构工程师。
请仔细阅读我上传/提供的课件（PPT/PDF 文档内容），根据讲义内容进行深度的“导学案设计”、“Markdown结构化提炼”、“核心词汇/背诵卡片提炼”以及“随堂测验题设计”，并严格输出符合指定 JSON Schema 的 JSON 数据。

---

### 一、 核心任务要求

#### 模式 A：Gemini 课件笔记 Slide Notes 格式 (推荐阵列格式)
输出一个 JSON 数组，数组中每个元素对应 PPT/PDF 的 1 页物理 slide（按 slide_number 从 1 到 N 顺序排布）：
- `slide_number`: 物理绝对页码（数字，从 1 开始，封面必须算作第 1 页 1）。
- `title`: 包含 `original`（原文标题）和 `translation_cn`（中文译名）的对象。
- `summary`: 本页讲义/Slide 的提炼摘要与概述。
- `core_points`: 本页 1~3 条核心知识考点字符串数组。
- `vocabulary`: 本页提取的核心词汇与专有名词对象数组，每项包含 `term_original`, `phonetic`, `meaning_cn`, `usage_context`。
- `flashcards`: 本页提炼的背诵/复习卡片对象数组，每项包含 `front`（提问）和 `back`（解答）。

#### 模式 B：标准 Courseware Studio 聚合对象格式
输出包含 `title`, `tags`, `coursewareURI`, `studyGuide`, `pageMarkdowns`, `quizCheck` 的单对象 JSON。

---

### 二、 输出格式规范（极其重要）

1. 必须严格输出合法的 JSON 数据，不得包含任何 Markdown 代码块标签（如不要带 ```json ），也不得在 JSON 前后附加任何解释性文字或引言。
2. 保持键名与数据类型完全与以下 Schema 格式一致：

#### 模式 A Schema (Gemini Slide Notes 数组):
```json
[
  {
    "slide_number": 1,
    "title": {
      "original": "兰纳社会：从个人到城邦的微观与宏观",
      "translation_cn": "兰纳社会：从个人到城邦的微观与宏观"
    },
    "summary": "本页作为讲义封面，简述了兰纳社会从微观个体到宏观城邦的传统空间、社会与精神秩序...",
    "core_points": [
      "兰纳社会学分析的核心在于将物理空间、社会组织与精神秩序三者合一。",
      "通过探索“Tua-Huen-Ban-Muang”这一套层嵌套的“同心宇宙”，揭示泰北传统的空间与精神秩序。"
    ],
    "vocabulary": [
      {
        "term_original": "Tua",
        "phonetic": "[tūa]",
        "meaning_cn": "个人/身体",
        "usage_context": "同心宇宙中最核心、最微观的个人层面。"
      }
    ],
    "flashcards": [
      {
        "front": "兰纳社会空间与精神秩序中，由微观到宏观的核心同心结构是什么？",
        "back": "由微观到宏观依次为：Tua（个人）-> Huen（家庭）-> Ban（村落）-> Muang（城邦）。"
      }
    ]
  }
]
```

#### 模式 B Schema (Courseware 聚合对象):
```json
{
  "uuid": "cw_auto_generated",
  "title": "课程/课件完整标题",
  "tags": "标签1,标签2,标签3",
  "coursewareURI": "coursewares/文档文件名.pdf",
  "studyGuide": {
    "warmup": {
      "q": "课前预热思考题？"
    },
    "pageGuides": {
      "1": {
        "question": "第1页导学思考题？",
        "ref": "第1页参考答案及详解。",
        "keywords": ["关键词1", "关键词2"]
      }
    },
    "summary": {
      "q": "课后总结复习题？"
    }
  },
  "pageMarkdowns": {
    "1": "# 第一页标题\n\n- 重点概念1\n- 重点概念2"
  },
  "quizCheck": {
    "1": [
      {
        "question": "基于第1页内容的单选题题干？",
        "options": {
          "A": "选项A内容",
          "B": "选项B内容",
          "C": "选项C内容",
          "D": "选项D内容"
        },
        "answer": "A",
        "explanation": "答题解析与讲义依据。"
      }
    ]
  }
}
```

### 绝对页码与封面对齐规范（极度重要）：

1. PDF/PPT 的封面/标题页必须严格算作第 1 页 (`slide_number: 1` 或 `"1"`）。
2. 所有的页码 Key（包含 slide_number 以及 pageGuides, pageMarkdowns, quizCheck 中的 `"1"`, `"2"`, `"3"`...）必须严格与 PDF/PPT 的物理绝对页码 1:1 保持一致。
3. 如果第 1 页是封面且没有测试题或思考题，直接跳过或者记录封面摘要即可。包含实质内容的物理第 2 页必须标注为 2（`"2"`），绝不能将物理第 2 页写为 1。
