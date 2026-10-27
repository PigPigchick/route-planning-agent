# 协议征询函接口与输入说明

协议清单是起点。每条事项默认生成一份函件；同一单位多个事项如需合函，应由业务方先明确合并范围。本实现不自动合并不同路径或不同轮次。

## 输入来源

| 数据 | 字段 | 来源 |
|---|---|---|
| 工程 | project.id/name/version/voltage/stage/overview | 统一工程对象，概况可人工补充 |
| 发文信息 | issuer/issueDate/documentNumber/contactName/contactPhone/replyAddress | 人工填写或业务系统；字号码可选 |
| 路径 | route.id/version/summary | 选中路径与 GIS 已确认的语义描述 |
| 协议事项 | agreements[].id/unit/type/scope/points/status | 平台协议清单；区域、部门、完成情况 |
| 历史回函 | replySummary/previousLetter/changeSummary | 平台台账或人工录入 |
| 专项资料 | facts / crossings | 平台已计算、已确认的技术参数 |
| 实际附件 | attachments[].name/kind/assetId/routeVersion | 上传接口或后续对接工程文件服务 |
| 模板适用性 | templateConfirmed | 人工核对 |

轮次 round 为 first / repeat / revised；status 可为未发函、已发函待复函、已完成。未选 agreementIds 时默认排除已完成。系统“已复核”与平台“已完成”分别记录，不自动把复核认定为发函或取得回函。

| type | 专项必填 facts | 需关联的实际附件 |
|---|---|---|
| general | 无统一数值项 | 路径图 |
| water | facilityName、spanStart、spanEnd、coordinateSystem | 路径图、坐标表 |
| highway | facilityName、spanStart、spanEnd、angleDeg、spanLengthM、horizontalDistanceM、clearanceM、chainage | 航带图、平断面图 |
| mineral | leftBufferM、rightBufferM、coordinateSystem | 路径图、坐标表 |
| aviation | facilityName、coordinateSystem、elevationDatum | 路径图、杆塔坐标高程表 |
| grounding | 本次事项明确接地极址及接地极线路范围 | 路径图 |
| railway | facilityName（铁路设施名称） | 路径图、坐标表 |
| seismic | 本次地震监测协调事项 | 路径图、坐标表 |
| military | 本次军事设施协调事项 | 路径图、坐标表 |

公路及河道多档跨越使用 `crossings` 数组，每行使用相应类型的上述字段；1–50行，以行数据为准，只继承通用设施名称和坐标基准。省略时保留 `facts` 单档兼容。可选 `subject` 用于不含工程名的征询主题。完整示例见 `使用文档与样例/规则优化与多档跨越说明_2026-10-27.md`。

M 后缀单位为米，angleDeg 为度；以 JSON number 传入，零值不会当成缺失。程序不推算这些数值。坐标表和图纸本期作为实际附件接收，不自动从文件提取表格或空间事实。

## 三个业务接口

先 `POST /api/v1/context` 注册现有工程上下文，获得 contextId。然后调用：

```json
{
  "contextId": "CTX-...",
  "agentType": "letters",
  "routeIds": ["A"],
  "options": {
    "mode": "llm",
    "agreementIds": ["L-01"],
    "lettersInput": {
      "schemaVersion": "letters-v2",
      "project": {
        "id": "PRJ-2026-018",
        "name": "粤东—云峰 500kV 输电线路工程",
        "version": "v1.0",
        "voltage": "500kV",
        "stage": "可行性研究",
        "isDemo": true,
        "overview": "人工确认的工程概况",
        "issuer": "演示设计单位",
        "issueDate": "2026-10-22",
        "documentNumber": "",
        "contactName": "演示联系人",
        "contactPhone": "填写真实工作电话",
        "replyAddress": "填写复函地址"
      },
      "route": {"id":"A","version":"v1.0","summary":"人工确认的选中路径描述"},
      "templateConfirmed": true,
      "agreements": [{
        "id":"L-01","unit":"演示林业主管部门","type":"general",
        "scope":"征询行政区域或区段","points":"需要征询的具体事项",
        "status":"未发函","round":"first","previousLetter":"","changeSummary":"",
        "replySummary":"","facts":{},
        "attachments":[{"name":"路径图.pdf","kind":"路径图","assetId":"ASSET-实际上传返回值","routeVersion":"v1.0"}]
      }]
    }
  }
}
```

提交到 `POST /api/v1/tasks`。mode 可为 template（无需密钥）或 llm。省略 lettersInput 时，仅为兼容旧接口，从统一上下文构造带缺项的模板输入；实际函件建议完整提交上述结构。

`POST /api/v1/tasks/{id}` 支持：

```json
{"action":"status"}
```

```json
{"action":"edit","letterId":"LETTER-1","expectedRevision":1,"bodyBlocks":["第一段","第二段"]}
```

```json
{"action":"confirm","letterId":"LETTER-1","expectedRevision":2,"reviewer":"复核人","note":"正文、参数、收函单位与附件已核对"}
```

```json
{"action":"export","format":"docx","letterId":"LETTER-1"}
```

```json
{"action":"export","format":"zip"}
```

任务状态 running → awaiting_confirmation → confirmed；全部模型调用失败为 failed。函件状态为 pending（排队）、generating（接收正文）、checking（检查输出）、incomplete（正文已检查但资料待补）、blocked（核心资料阻断）、needs_rewrite（事实变化后待重写）、draft（正文及资料检查通过）、failed、confirmed。只有 draft 可以确认，只有 draft / confirmed 可以导出。修改普通资料及附件不调用模型，保留正文和人工编辑；已确认版本修改后需重新复核。

普通资料更新仍复用第三个业务接口，提交完整输入和**任务**修订号（不是函件修订号）：

```json
{"action":"update-input","expectedRevision":3,"lettersInput":{"schemaVersion":"letters-v2","project":{},"route":{},"agreements":[],"templateConfirmed":true}}
```

lettersInput 应使用上面的完整有效输入，此处仅示意结构。工程、版本和路径须保持一致；不能移除当前任务已有函件对应的协议事项。新增协议事项保存到输入，下次主动起草才会生成新函件。若只修改日期、发函单位、联系人、收函单位或附件，后端更新标题、落款、附件和缺项检查，保持正文不变。若修改路径描述、工程概况、征询事项、专项事实、区段、类型或轮次，保留原正文供参考并标记 needs_rewrite，禁止确认和导出；用户可显式重新起草，或人工编辑正文后重新检查和复核。操作会递增受影响函件修订号及任务修订号；无变化不递增。inputUpdates 保留更新前的输入，confirmations 保留历史版本的复核记录。

运行中的 status 响应包含 startedAt、currentLetterId、currentUnit、progress；函件包含 startedAt、live.phase（waiting / thinking / writing / checking / complete / failed）、live.stream 和 previewText。预览只提取 bodyBlocks 并替换事实占位符，尚未经完整检查，不能用于确认或导出；reasoning_content 不保存或返回。未开启 stream 时只显示等待状态，完整输出后展示正文。刷新页面可自动继续查询任务。模型返回完整 JSON 并通过 applyModel 检查后才写入 bodyBlocks；失败时 error 给出原因，bodyBlocks 留空。

输出 `result.letters[]` 包含正文段落 bodyBlocks、完整预览 text、程序参数表 tables、模板来源及版本 templateRef、missingFields（含 blocking）、attachments（含 available）、generation（模式、模型、时间、usage）、edits 和 confirmations。`result.summary` 为各状态数量。模型失败时保留 error，禁止导出失败函件；部分失败可单独导出其他成功函件。

## 配套接口

- `GET /api/v1/model-config`：读取地址、模型、JSON 模式、keyConfigured，绝不返回密钥。
- `POST /api/v1/model-config`：baseUrl、model、apiKey、jsonMode、clearKey。apiKey 留空保留，clearKey 清除。
- `POST /api/v1/model-test`：只发送连通性 JSON 测试，不携带工程资料。
- `POST /api/v1/assets`：name、base64，返回 id/name/size。附件类型白名单，单文件最大 10MB。
- `GET /api/v1/files/{fileId}`：下载导出操作返回的文件。ZIP 包含 Word、原始附件、Excel/CSV 台账、缺失附件清单、人工复核记录。

本机后端的来源白名单默认允许 5173；文件和密钥均保存在忽略目录 `.local-data/`。本地原型没有组织级账号权限，部署前需对接统一认证。

模型配置补充 stream（boolean）与 thinkingMode（auto/on/off）。stream=true 时使用 SSE 接收，thinkingMode=on/off 时在兼容请求顶层发送 enable_thinking=true/false；auto 则不发送该字段。此参数与 Python SDK 的 extra_body 中 enable_thinking 含义相同。连通测试额外返回 durationMs、usage、stream、thinkingMode；不返回密钥或推理通道内容。


四个智能体共用 GET/POST /api/v1/model-config 和同一份本机设置。返回 revision/updatedAt/scope=shared，提交 expectedRevision 可防止覆盖旧配置。留空密钥保留原值；未改配置不增加版本号。任务启动后固定配置快照，后续全局修改只影响新任务。


## 模拟流程

在 `POST /api/v1/tasks` 的 letters options 中设置 `simulation: true`（仍传 `lettersInput` 和 `agreementIds`）。后端强制使用保存的共享模型，以独立任务运行；返回后用原状态接口轮询。`simulation.stage` 显示进度，`filledFields` 记录模型补齐项，`confirmations` 记录自动模拟确认，`export` 提供最终 ZIP 下载链接。最终成功状态为 `simulation_completed`，函件状态为 `simulated`，与真实 `confirmed` 分开。

模型只补缺失白名单字段。附件由程序生成带模拟标记的 TXT 文件，仅验证文件关联和打包；不生成真实 GIS 或测量成果。模拟确认不写入人工复核记录。模拟任务拒绝 edit / confirm / update-input，原输入和真实任务保持不变。任何模型、资料、正文或导出错误均返回 failed 任务及具体原因。

测试命令：`npm run test:simulation`，使用隔离临时目录和本机流式模拟模型，覆盖五类模板、失败路径、Word/ZIP 及重启恢复。


## 模板、单位目录与台账（2026-10-25）

- `GET /api/v1/letter-resources`：读取结构化模板、区划/单位目录、空间关系及维护记录。
- 同地址POST支持 `save-template`、`set-template-enabled`、`import-directory`、`import-relations`，均须传 `expectedRevision` 和 `actor`。导入替换对应整批目录/关系；失败不修改原数据。
- 同地址POST `action: recommend` 携带 `lettersInput`，只返回当前工程、路径和版本的单位候选、来源及无匹配/多候选状态；不直接确认、不调用模型。
- 单位目录包含 `id/unit/areaCodes/featureIds/types/relationTypes/basis/role/enabled/validFrom/validTo`；区划包含 `code/name/source`。适用范围、关系类型和管理依据必填。
- 空间关系包含 `id/projectId/routeId/routeVersion/segmentId/scope/featureId/featureName/type/relationType/areaCodes/points/evidence/reviewed`；这些是平台或业务方的结构化结果，不是系统自动从原始GIS量算。
- 选择候选后，前端要求人员确认，形成带 `authorityId/adminAreaCodes/featureId/recipientEvidence` 的协议事项；目录为空时不猜单位。
- 协议事项可用 `templateId` 明确模板；未指定时优先匹配对应 `authorityId` 的单位专用模板，再回退协议类型通用模板；多个专用候选须手选。模板 `unitIds` 为空表示通用。模板正文使用受控占位符，必填参数和附件按类型维护；停用只影响新任务，历史任务保存 `templateCatalog` 快照。
- 正式前端模型任务提交 `requireListConfirmation: true` 和 `listConfirmation`，后端校验人员、意见与当前选中单位/区段/事项签名；改变相关字段需重确认。旧接口保留兼容；模拟与固定模板预览不冒充正式清单确认。
- `POST /api/v1/tasks/{id}` 的 `action: record-correspondence` 传 `expectedRevision`、`letterId`、`actor` 和 `record`。`record.state` 为未发出/已发出待回复/已回复/已闭环，另含 `sentAt/replyAt/replySummary/closureNote/referenceNumber/notes/correctionNote`。登记发出及后续状态要求当前函件已人工复核；回复需有效发出/回复日期与摘要，闭环需处理结果，状态回退需更正原因。
- 业务登记只增加任务修订，保留函件修订和正文；`correspondenceHistory` 保存每次前后值及登记人。资料修改后旧发出记录保留 `sentRevision` 并在页面提示核对。
- `action: export, format: xlsx` 导出当前任务所有函件的真实Excel台账，资料待补/生成失败也可列入台账；不代表准许导出正式函件。Word/ZIP仍校验函件状态和实际附件。新ZIP包含`.xlsx`、兼容CSV及业务变更记录JSON。
- 前端入口在“更多操作”，业务登记在函件预览区；本机角色名称为人工输入，生产账号权限与甲方系统自动回写尚待对接。

验证：`npm run test:letters-management`。测试仅使用临时目录和本机服务，不需要模型密钥；XLSX及ZIP检查使用Python标准库，迁移设备无需额外安装表格运行库。
