# RRA 双路径报告接入输电工作台

RRA 运行依赖来自 [qspang/RRA 的 RoadDescription](https://github.com/qspang/RRA/tree/04f4fa89eddc5013a3fa10d31391a7e9a13bc3eb/RoadDescription)，固定版本为 `04f4fa89eddc5013a3fa10d31391a7e9a13bc3eb`。本仓库发布工作台接入代码和适配补丁。安装命令直接从上游取得服务源码并应用补丁，运行目录留在本机。

工作台通过现有工程和任务接口调用本机 Python 服务。提交时保存工程编号、版本、北南方案与上传文件的 SHA-256。RRA 使用该工程版本登记的地图与 GIS 图层计算路径指标及空间关系。工作台校验返回的工程和文件指纹后展示进度、线路长度、审阅状态及下载入口。报告按任务留存在本地，可从工程总览的任务记录重新查看。

## 配置本机

1. 在主项目安装 Node 依赖后，从项目根目录安装 RRA 并创建 Python 3.12 环境。使用绝对路径或 PATH 中可用的 LibreOffice `soffice` 生成 PDF。

   ```bash
   npm run setup:rra
   python3.12 -m venv services/rra/runtime/.venv
   services/rra/runtime/.venv/bin/python -m pip install -r services/rra/runtime/requirements.txt
   ```

2. 准备工程版本、两条同起终点的 WGS84 KML，以及匹配的 GIS 数据包。数据包包括预处理目录中的 `manifest.json`、`m1/standardized_features.gpkg`、`m3/rule_config.json`，以及同版 `map.json` 和 `map.raw.json.gz`。按工程资料配置行政边界、高程、版式参考 PDF 和补充图层。两份 KML 各不超过 2 MB，且应位于该地图范围内。
3. 在 `.local-data/rra/` 保存工程配置和清单。在 RRA 运行目录的 `configs/` 下取用 `config.dapu-kml.example.json` 和 `studio-projects.example.json` 作为模板。将 `project_root` 设为 RRA 运行目录，用本机资料路径填写 `dataset`、`output_dir`（地图快照目录）、`reference_pdf` 和可用图层。清单中的 `projectId` 和 `projectVersion` 要与工作台一致，`config` 路径相对于清单所在目录。按需配置高程、LibreOffice、LLM 和 VLM。
4. 在项目 `.env.local` 设置 `TX_RRA_PROJECTS=.local-data/rra/studio-projects.json`，运行 `npm run start:local`。默认使用 RRA 运行目录的 `.venv/bin/python`，也可通过 `TX_RRA_PYTHON` 指定已有环境。手工启动的 RRA 服务可通过 `TX_RRA_BASE_URL` 接入。

已有工作环境直接安装在 `services/rra/` 时，可继续使用该运行目录及其本机配置。

图件优先使用本机中文字体。需要指定字体时，在启动前设置 `ROAD_REPORT_FONT` 为相应字体文件路径。

## 工作台操作

在工作台导入含两条或以上候选路径的完整工程 JSON。打开「路径方案比选」→「双路径 KML 报告」，分别选择北、南对应的工程路径和文件，然后提交。报告区自动刷新进度。

任务完成后，「路径描述」「路径方案比选」「路径合规分析」显示同一任务的对应报告。在「报告记录」中切换当前工程版本的历史报告。合规页可选北方案或南方案，比选页可阅读综合报告并下载原始成果。

在报告正文点「审校此段」即可编辑和保存。保存后可下载审校版 Word 和 PDF。已有其他修订时，页面提示刷新正文并保留当前编辑内容。综合报告支持阅读，修订保存到对应分册。填写修改要求并点击「生成建议」会调用该工程配置的 RRA 模型，保存仍需人工确认。

## 隔离联调

在项目根目录运行 `npm run test:rra`。测试创建独立的 GIS 数据和双 KML，启动临时报告服务和 Node 后端。验证范围包括工程版本、文档与图片读取、段落保存、版本冲突、历史任务隔离、重启恢复和 Word 下载。设置 `TX_RRA_TEST_SOFFICE` 后还会验证原版和审校版 PDF。测试使用本机模板和 GIS 运算。
