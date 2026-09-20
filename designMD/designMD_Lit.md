# Design Document & Prompt: 文学分析练习辅助桌面应用 (Literacy Analysis Practice Desktop App)

## 1. 项目概述与架构设计 (Overview & Architecture)
本项目旨在开发一款面向桌面端 (Desktop Web App) 的文学作品分析与练习辅助工具。系统采用**前后端分离**架构：
- **后端服务 (Backend)**：Node.js + Express + SQLite 数据库。负责存储多体裁文学作品（小说 Fiction、诗歌 Poetry、散文 Essay、戏剧 Drama）的通用 JSON 数据、用户练习记录、错题本及答题进度。
- **前端界面 (Frontend)**：基于原生 HTML5, Tailwind CSS, JavaScript (SPA 单页应用) 构建。通过动态组件渲染引擎，根据后端返回的 `genre`（体裁类型）字段自动适配对应的UI分析表单、讨论题及 5W1H 文本细读模块。

---

## 2. 后端数据结构与 SQLite 设计 (Database & API Spec)

### 2.1 SQLite 数据表结构
1. **`works` (作品与练习主表)**
   - `id` (INTEGER, Primary Key)
   - `exercise_id` (TEXT, Unique)
   - `genre` (TEXT): `fiction`, `poetry`, `essay`, `drama`
   - `title` (TEXT)
   - `author` (TEXT)
   - `description` (TEXT)
   - `content_json` (TEXT): 存储完整的结构化练习内容（即上文设计的通用多体裁 JSON）

2. **`user_progress` (用户答题与练习记录表)**
   - `id` (INTEGER, Primary Key)
   - `user_id` (TEXT): 学生或辅导员ID
   - `exercise_id` (TEXT)
   - `answers_json` (TEXT): 用户填写的答案数据
   - `score` (REAL)
   - `updated_at` (DATETIME)

### 2.2 核心 API 设计
- `GET /api/exercises`：获取所有可用的文学练习列表（支持按 `genre` 筛选）。
- `GET /api/exercises/:exercise_id`：获取特定文学作品的完整 JSON 结构（供前端动态渲染）。
- `POST /api/exercises/submit`：提交或保存用户的练习进度与答案。
- `GET /api/progress/:user_id`：获取指定用户的历史练习与错题记录（方便辅导员跟进）。

---

## 3. 前端界面设计与核心功能 (Frontend UI & Features)

### 3.1 核心视图模块
1. **作品广场与筛选面板 (Dashboard)**：支持按体裁（Fiction, Poetry, Essay）快速筛选文学作品卡片。
2. **动态渲染工作区 (Dynamic Exercise Workspace)**：
   - 根据作品的 `genre` 自动切换表单模板：
     - **Fiction 模板**：渲染冲突（Conflict）、人物（Characters）、场景（Setting）。
     - **Poetry 模板**：渲染意象（Imagery）、修辞手法（Poetic Devices）、韵律。
     - **Essay 模板**：渲染中心论点（Central Argument）、作者视角（Perspective）。
   - **通用模块**：底部挂载讨论题（Discussion Questions）输入框与 5W1H 语法细读填空。
3. **反复练习与比对模式 (Practice & Review Mode)**：
   - 支持“练习模式”（填写并保存答案）与“参考答案对照模式”（一键对比标准答案）。
   - 错题自动归档，支持反复重练。
4. **辅导员管理视图 (Tutor View)**：
   - 允许辅导员查看学生的提交记录、答题正确率与文本分析批改建议。

---

## 4. 给 Antigravity 的开发提示与执行指令 (Prompt for Antigravity)

请根据以下指令，在本地环境中启动并开发该桌面端 Web 应用：

1. **项目初始化**：
   - 在数据库中预置包含 `fiction`（《ข้างหลังภาพ》）、`poetry`、`essay` 的多体裁示例 JSON 数据。
2. **前端单页应用 (SPA)**：
   - 采用纯净的 HTML + Tailwind CSS CDN + 原生 JavaScript 构建响应式 UI，无需复杂的 Webpack 配置，确保轻量快速。
   - 编写动态渲染引擎函数 `renderExercise(data)`：通过读取 `data.genre` 动态生成对应的文学分析输入表单。
3.在现有node.js后台服务中增加CRUD API接口
4.数据库中预置如下JSON数据
{
    "exercise_id": "intro_to_literature_multigenre_01",
    "course": "Introduction to Literature",
    "description": "支持多种文学体裁（小说、散文、诗歌、戏剧）的通用文学分析与练习 JSON 结构",
    "supported_genres": [
        "fiction",
        "poetry",
        "essay",
        "drama"
    ],
    "exercises": [
        {
            "genre": "fiction",
            "title": "ข้างหลังภาพ (Behind the Painting)",
            "author": "ศรีบูรพา (Kulap Saipradit)",
            "description": "叙事小说分析模板（以泰语小说《后面画》为例）",
            "sections": [
                {
                    "section_number": 1,
                    "section_title": "การวิเคราะห์องค์ประกอบวรรณกรรม (小说文学要素分析)",
                    "content": {
                        "conflict": {
                            "type": "ความขัดแย้งระหว่างมนุษย์กับตัวเอง (Man against himself) และความขัดแย้งระหว่างมนุษย์กับสภาพสังคม/ศีลธรรม",
                            "details": "ม.ร.ว.กีรติแต่งงานกับพระยาอธิการบดี แต่พบรักแท้กับนพพร ต้องข่มใจรักษาเกียรติยศและศีลธรรม",
                            "ending": "โศกนาฏกรรม (Tragic ending): ม.ร.ว.กีรติเสียชีวิตด้วยโรควณโรค ทิ้งไว้เพียงภาพเขียนและข้อความระลึกถึงความรัก"
                        },
                        "characters": {
                            "main_characters": [
                                {
                                    "name": "ม.ร.ว.กีรติ",
                                    "role": "ตัวละครเอกหญิง",
                                    "description": "ราชนิกุลหญิงอายุ 35 ปี สวย อ่อนหวาน รักศิลปะ"
                                },
                                {
                                    "name": "นพพร",
                                    "role": "ตัวละครเอกชาย",
                                    "description": "นิสิตหนุ่มไทยอายุ 22 ปี เรียนต่อที่ญี่ปุ่น รักร้อนแรงแต่เปลี่ยนไปตามกาลเวลา"
                                }
                            ],
                            "supporting_characters": [
                                {
                                    "name": "พระยาอธิการบดี",
                                    "role": "สามีของ ม.ร.ว.กีรติ",
                                    "description": "ข้าราชการอายุ 50 ปี พ่อหม้ายลูกติด"
                                }
                            ]
                        },
                        "setting_and_atmosphere": {
                            "locations": [
                                "ประเทศไทย (สยาม)",
                                "ประเทศญี่ปุ่น (โตเกียว/ภูเขามิตาเกะ)"
                            ],
                            "time_period": "ประมาณ พ.ศ. 2480",
                            "atmosphere": "ญี่ปุ่นโรแมนติกอิสระ / สยามเคร่งครัดในกฎเกณฑ์และประเพณี"
                        },
                        "key_concept": "ไม่มีใครที่จะเพียบพร้อมทุกอย่างในชีวิต ความรักที่แท้จริงเกิดขึ้นผิดเวลาและไม่สามารถสมหวังได้"
                    }
                },
                {
                    "section_number": 2,
                    "section_title": "คำถามชวนคิดเพื่อการอภิปราย (讨论与思考题)",
                    "topics": [
                        {
                            "topic_name": "การวิเคราะห์ตัวละครและพฤติกรรม",
                            "questions": [
                                {
                                    "q_no": 1,
                                    "question": "นพพรรักจริงหรือไม่ และทำไมถึงเปลี่ยนใจ?",
                                    "answer": "รักจริงในแบบเด็กหนุ่ม แต่เปลี่ยนไปเพราะเวลา 6 ปี สังคม และหน้าที่การงาน"
                                },
                                {
                                    "q_no": 2,
                                    "question": "ทำไม ม.ร.ว.กีรติ ต้องแต่งงานและเก็บซ่อนความรู้สึก?",
                                    "answer": "แต่งงานตามอายุและค่านิยม เก็บความรู้สึกเพื่อรักษาเกียรติและศีลธรรม"
                                }
                            ]
                        }
                    ]
                },
                {
                    "section_number": 3,
                    "section_title": "แบบฝึกหัดหลักภาษา 5W1H (语法与文本细读)",
                    "exercises": [
                        {
                            "sentence": "พระยาอธิการบดีพาเธอไปเที่ยวประเทศญี่ปุ่น",
                            "who": "พระยาอธิการบดี",
                            "what": "พาเธอไปเที่ยว",
                            "where": "ประเทศญี่ปุ่น",
                            "when": "หลังแต่งงาน",
                            "how": "เดินทางเพื่อเปิดหูเปิดตา"
                        }
                    ]
                }
            ]
        },
        {
            "genre": "poetry",
            "title": "ฉันจึงมาหาความหมาย (Chanthu Ma Ha Khwam Mai) / 示例诗歌",
            "author": "วิทยากร เชียงกูล (Witthayakon Chiangkul)",
            "description": "诗歌分析模板（侧重意象、韵律与隐喻）",
            "sections": [
                {
                    "section_number": 1,
                    "section_title": "การวิเคราะห์องค์ประกอบบทกวี (诗歌要素分析)",
                    "content": {
                        "theme_and_tone": {
                            "main_theme": "การแสวงหาความหมายของชีวิตและคุณค่าความเป็นมนุษย์",
                            "tone": "มุ่งมั่น, สิ้นหวังแต่ไม่ยอมแพ้, สะท้อนสังคม"
                        },
                        "imagery_and_symbolism": [
                            {
                                "element": "ทางเดิน / รอยเท้า",
                                "meaning": "การเดินทางของชีวิตและการแสวงหา"
                            },
                            {
                                "element": "ความมืด / แสงสว่าง",
                                "meaning": "ความไม่รู้/ความกดดัน กับความหวังและปัญญา"
                            }
                        ],
                        "poetic_devices": [
                            {
                                "device": "Metaphor (การเปรียบเทียบ)",
                                "description": "เปรียบชีวิตเหมือนการเดินทางไกลที่ไร้จุดสิ้นสุด"
                            },
                            {
                                "device": "Repetition (การซ้ำคำ)",
                                "description": "เพื่อเน้นย้ำความตั้งใจและการวนเวียนของคำถามในใจ"
                            }
                        ]
                    }
                },
                {
                    "section_number": 2,
                    "section_title": "คำถามชวนคิดเพื่อการอภิปราย (诗歌意 义与赏析)",
                    "topics": [
                        {
                            "topic_name": "การตีความบทกวี",
                            "questions": [
                                {
                                    "q_no": 1,
                                    "question": "กวีพยายามสื่อถึงอะไรผ่านการเดินทาง?",
                                    "answer": "การตั้งคำถามต่อระบบสังคมและการค้นหาเป้าหมายที่แท้จริงของชีวิตมนุษย์"
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "genre": "essay",
            "title": "ตัวอย่างบทความแสดงทัศนะ / 散文/议论文",
            "author": "นามปากกา / นักเขียน",
            "description": "散文与随笔分析模板（侧重作者观点、论证与文风）",
            "sections": [
                {
                    "section_number": 1,
                    "section_title": "การวิเคราะห์โครงสร้างบทความ (散文/随笔要素分析)",
                    "content": {
                        "central_argument": "คุณค่าของการใช้ชีวิตเรียบง่ายท่ามกลางสังคมสมัยใหม่ที่เร่งรีบ",
                        "author_perspective": "ผู้เขียนมองว่าเทคโนโลยีทำให้มนุษย์ห่างเหินกันและสูญเสียความสงบภายใน",
                        "tone_and_style": "อบอุ่น, โน้มน้าวใจ, ใช้ภาษาเชิงพรรณนาเปรียบเทียบ (Descriptive & Reflective)",
                        "key_motifs": [
                            "ธรรมชาติ",
                            "เวลา",
                            "ความเงียบสงบ"
                        ]
                    }
                },
                {
                    "section_number": 2,
                    "section_title": "คำถามชวนคิดเพื่อการอภิปราย (散文观点讨论)",
                    "topics": [
                        {
                            "topic_name": "การวิเคราะห์แนวคิดผู้เขียน",
                            "questions": [
                                {
                                    "q_no": 1,
                                    "question": "ข้อโต้แย้งหลักของผู้เขียนคืออะไร และคุณเห็นด้วยหรือไม่?",
                                    "answer": "วิพากษ์วิจารณ์ทุนนิยมและเทคโนโลยีที่ทำลายความสัมพันธ์ในครอบครัว"
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}