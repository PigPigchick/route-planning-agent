# 输电智能体统一接口 v1

四个智能体共用三个 POST 接口。接口 01 提交工程快照，接口 02 发起智能体任务，接口 03 查询结果或保存人工确认。前端在“服务与接口 → 配置服务连接”设置服务基础地址。

## 运行边界

四个智能体已接入共享的大模型配置；数值、费用、评分和规则筛查仍由代码处理。协议征询函另支持逐函复核和 Word/ZIP 导出。未连接真实 GIS、CAD 解析服务，不输出审定合规意见。前端 127.0.0.1:5173 和后端 127.0.0.1:4318 独立运行。后端仅提供 API，适合本机联调。

## 01 工程上下文

`POST /api/v1/context`，`Content-Type: application/json`

请求体为完整工程对象，结构可在页面下载“工程上下文示例.json”。

| 字段 | 内容 |
| --- | --- |
| project | id、name、voltage、stage、start、end、version、dataDate、isDemo |
| routes[] | id、name、length(km)、towers、forest(km)、demolition(m²)、sensitive、redline、crossings、unitCost(万元/km)、areaRate(万元/m²)、crossingCost(万元/处)、terrain、via[] |
| issues[] | id、routeIds[]、title、type(missing/review/coordination)、segment、object、source、ruleId、detail、need[] |
| agreements[] | id、unit、type、segment、template、points、attachments[] |
| rules[] | id、name、version、kind、text、source |

所有确定性数值必须为非负、有限的 JSON number。缺失资料请通过 issues 明确记录，不应用零值伪装。routes 长度为 1–20；整个请求上限 2MB。

返回 201（已存在的同一快照返回 200）：

```json
{"contextId":"CTX-实际返回值","contextRevision":1}
```

每个 contextId 对应不可变的运行快照。征询函页面提交 contextType: letters：同一工程编号与业务版本的资料发生修改时，服务新建 contextId 并递增 contextRevision；内容相同则复用对应记录，历史记录与任务不被覆盖。完整 GIS 工程的空间参数或规则变化仍须使用新 project.version，否则返回 400。

## 02 智能体任务

`POST /api/v1/tasks`

```json
{
  "contextId":"接口01返回的contextId",
  "agentType":"comparison",
  "routeIds":["A","B","C"],
  "weights":{"economy":50,"ecology":30,"construction":20}
}
```

| agentType | 结果 | 依赖 |
| --- | --- | --- |
| comparison | result.ranked、descriptions、recommended、text、weights | 先逐条调用 description 能力，再计算与比选；至少选择两条路径 |
| compliance | result.issues、text | 按路径关联地物与规则，缺资料保持待核 |
| description | result.chapters[]、text | 单独生成路径描述章节 |
| letters | result.letters[] | 基于工程协议清单生成函件草稿 |

当前界面在非比选任务中只发送一条路径。weights 仅适用于 comparison，各值非负，合计 100。

同步返回 201；实际智能体服务也可先返回 running/queued，由接口 03 轮询。任务基本结构：

```json
{
  "id":"TASK-实际返回值",
  "contextId":"CTX-实际返回值",
  "projectId":"PRJ-2026-018",
  "projectVersion":"v1.0",
  "agentType":"comparison",
  "routeIds":["A","B","C"],
  "mode":"demo",
  "status":"awaiting_confirmation",
  "revision":1,
  "createdAt":"ISO-8601时间",
  "steps":[{"name":"调用路径描述智能体","detail":"已生成3份描述"}],
  "result":{"title":"路径方案比选建议","text":"...","descriptions":[],"ranked":[],"recommended":"B","weights":{"economy":50,"ecology":30,"construction":20}},
  "confirmations":[]
}
```

ranked 的每一项包含原始路径字段、calc（line/demolition/crossing/total，万元）、score、eligible。description.chapters 每项含 title、text；letters 每项含协议字段和 text。正式服务应保持这些字段供前端显示。

## 03 查询结果 / 人工确认

`POST /api/v1/tasks/{taskId}`

查询请求：

```json
{"action":"status"}
```

确认请求：

```json
{
  "action":"confirm",
  "expectedRevision":1,
  "reviewer":"复核人员姓名",
  "note":"已核对工程快照，跨越缺项保留并安排补充资料。",
  "editedText":"可选：仅路径描述任务支持保存校核后的正文"
}
```

确认仅允许 awaiting_confirmation 状态，必须提供非空 reviewer、note，并匹配 revision。结果进入 confirmed，revision 加 1，追加 `{reviewer,note,at,revision}`。不删除风险、不将资料不足自动标记为合规、不发送函件。已确认任务不能重复确认；需修改时新建分析任务。

状态：`queued/running → awaiting_confirmation → confirmed`，错误执行可返回 `failed` 和 error。前端每秒查询运行中的任务，约 46 次后提示超时，后端任务不会因此取消。

## 错误、认证与扩展

错误 JSON：`{"error":{"code":"VALIDATION_ERROR","message":"具体原因"}}`。

演示服务支持 400 参数错误、403 来源/Host 校验失败、404 对象不存在、405 方法不支持、409 快照冲突、415 非 JSON 请求。

生产接入由业务网关承担身份认证、权限、审计、任务队列、持久化和限流。reviewer 在本机演示中为人工输入；生产应由登录身份确定。模型密钥只保存在后端，前端不接收模型密钥。跨域使用显式 CORS 来源白名单；本机服务支持 TX_ALLOWED_ORIGINS（逗号分隔），默认允许 http://127.0.0.1:5173 和 http://localhost:5173，其余来源须显式配置。

替换智能体实现时，在服务侧将 makeTask 调用替换为实际 adapter：先进行工程数据校验与代码计算，再将经过确认的文本与数值交给文字生成服务。比选必须先调用描述能力；新增规范通过新规则包与快照接入，并配置真正的规则计算处理器，自由文本元数据不会自动执行。

## 演示计算口径

费用（万元）= length × unitCost + demolition × areaRate + crossings × crossingCost。

经济分 = 100 × 当前参与方案的最小费用 / 本方案费用；生态分 = max(0,100 − forest × 2 − sensitive × 8)；施工分 = max(0,100 − crossings × 4 − towers × 0.12)。综合分为三项按权重加权，保留两位小数。redline > 0 不参与推荐。所有价格、权重与扣分系数均为示例，不代表规范或审定造价。

## 协议征询函 letters-v2 扩展

POST /api/v1/tasks 通过 options.mode（template / llm）、options.lettersInput（schemaVersion: letters-v2）、options.agreementIds 指定函件输入与事项；界面可导入和下载完整输入 JSON。project 与 route 必须对应已注册工程快照。省略 lettersInput 时兼容原有调用，自动构造带缺项的模板输入。

函件结果新增 bodyBlocks、tables、templateRef、missingFields、attachments.available、generation、confirmations、revision。POST /api/v1/tasks/{id} 的 edit / confirm 需要 letterId 和该函件 expectedRevision。缺项未齐不能确认；确认后编辑将重置该函件复核状态。export 操作通过 format: docx / zip 导出，单函 Word 需提供 letterId，返回 fileId/name/url。通过 GET url 下载。

配套接口：GET/POST /api/v1/model-config，POST /api/v1/model-test，POST /api/v1/assets，GET /api/v1/files/{fileId}。配置界面位于工作台右上角“设置 → 大模型配置”；密钥由后端保存和使用，不返回前端。模型调用失败明确报错，不回退模板。

函件的普通资料更新通过同一接口提交 `{action:"update-input", expectedRevision:任务修订号, lettersInput:完整输入}`，不调用模型，保留正文及人工编辑。日期、联系人和附件保存后直接更新；正文事实变化标记 needs_rewrite，需主动重新起草或人工修订后再复核。资料修改会使受影响的旧版确认失效，历史确认保留。

函件状态扩展为 pending / generating / checking / incomplete / needs_rewrite / blocked / draft / failed / confirmed。只有完整正文检查及资料检查通过才进入 draft。status 返回 currentUnit、startedAt，以及函件 live.phase 和 previewText；前端每 750 毫秒查询，刷新后自动跟踪运行中的任务。预览不包含推理通道，不可确认或导出；未开启流式时显示等待，完整返回后展示正文。

函件详细字段、专项模板和请求示例请查看项目根目录 LETTERS.md。


## 四智能体共享模型配置

GET/POST /api/v1/model-config 始终操作同一份共享配置，与当前页面和工程无关。GET 返回 scope=shared、agentTypes、revision、updatedAt 和 keyConfigured，不返回 apiKey。POST 可携带 expectedRevision 防止覆盖其他页面的修改；apiKey 为空时保留原值。配置未变化返回 unchanged=true 且版本号不变。修改后 revision 递增，立即用于后续创建的任务。

POST /api/v1/tasks 的 options.mode 对四类智能体均支持 llm/template；省略时，有配置默认 llm，无配置默认 template。LLM 任务先返回 running，通过 status 轮询。响应 modelConfig 固定保存本次使用的模型地址、名称、参数及配置版本，不含密钥。comparison 的 description 前置调用与主分析使用同一快照。其他三个智能体结果仍兼容原有 text/chapters/descriptions/ranked/issues 字段。


## 协议征询函本轮补充（2026-10-25）

配套 `GET/POST /api/v1/letter-resources` 用于结构化模板增改停/历史版本、单位与区划目录和空间关系导入，以及带依据的单位候选匹配。相关JSON、版本校验、清单确认与目录字段见根目录 LETTERS.md；前端入口在“更多操作”。

`POST /api/v1/tasks/{id}` 新增 `action=record-correspondence`，独立登记发出、回复、闭环及变更历史；`action=export` 的 format 新增 xlsx，真实Excel台账也会加入新导出的ZIP。业务登记不调用模型、不发送函件，不把已复核当作已发出。

本机正式单位目录和空间关系需要业务方导入；原始GIS解析、权属认定、组织权限、甲方私有化模型和平台自动回写不由这些接口自动完成。


## 多档跨越与专项类型（2026-10-27）

协议类型新增 `grounding / railway / seismic / military`。可选 `subject` 为不含工程名称的征询主题（单行，最多180字）。`highway / water` 可传 `crossings` 数组（1–50行），逐行校验并生成技术表；省略时兼容原 `facts` 单档。字段、界面操作及 JSON 样例见 `使用文档与样例/规则优化与多档跨越说明_2026-10-27.md`。原任务、配置、复核和导出接口不变。

## Excel工程与协议清单输入（2026-10-28）

`POST /api/v1/letter-input/parse` 接收 `{name:"资料.xlsx",base64:"文件内容"}`，返回 `{sheets:[{name,rows:[[单元格值]]}]}`。仅支持.xlsx，最大6MB；拒绝公式、错误值和超限内容。解析不保存工程、不创建任务、不调用模型。前端据“工程信息”“协议清单”“附件清单”映射字段、展示缺项，用户确认后写入工作副本。

函件输入最多500条，每次通过`agreementIds`起草最多30条。`contextType:"letters"`可注册仅含工程、路径描述和协议清单的上下文，不用虚构GIS数值；该上下文仅能运行letters，其他智能体需完整参数。真实附件仍通过`/api/v1/assets`上传并绑定assetId；Excel中的文件名仅登记附件需求。字段说明见`使用文档与样例/Excel工程与协议清单导入说明_2026-10-28.md`。

### 资料核对清单 Word 导出

向 `POST /api/v1/tasks/{taskId}` 提交 `{"action":"export","format":"materials-docx","stale":false}`，返回文件编号、`.docx` 文件名和下载地址。清单按收函单位汇总该任务记录中的待补信息、附件关联及核对事项，包含具体情况和处理方式。`stale` 为 true 时注明当前输入尚未同步。此导出允许任务生成中、资料不全或生成失败，不调用模型，不修改任务、输入或复核状态。


## PostgreSQL 工程存储与 RAG

配置 `TX_DATABASE_URL` 后使用PostgreSQL＋pgvector；连接失败时明确停止启动，不自动回退JSON。旧records.json首次迁移前备份，实际附件及导出文件继续保存在本机目录。独立测试指定TX_DATA_DIR时默认使用JSON；需要测试数据库时同时指定TX_USE_DATABASE=true和临时数据库连接。

- GET `/api/v1/storage`：数据库连接及pgvector版本，不返回连接密码。
- GET `/api/v1/projects`：工程目录、工作副本及修订号。
- POST `/api/v1/projects`：保存entry、workingCopies、deleted及expectedRevision。旧修订号返回409；action=reset隐藏当前工程并保留历史任务。
- GET `/api/v1/tasks`：加载历史任务，可用projectId、version筛选。
- GET `/api/v1/knowledge`：资料列表及向量检索配置，不返回API Key。
- POST `/api/v1/knowledge`：action为configure/test/ingest/sync-templates/search/set-enabled。入库支持text或name/base64文件；向量接口沿用共享模型服务。资料包含kind、type、projectId及projectVersion，用于过滤适用范围。

RAG仅在显式模型起草时检索。letter.retrieval保存实际使用的片段、标题及分数；原事实占位符、数值及审批断言检查继续生效。模板修改或停用后旧模板索引停用，手动同步有效模板建立新版本索引。
