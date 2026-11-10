# Design Studio 渲染保真 R007（2026-11-07）

**状态：BLOCKED checkpoint。32 个生产小实验通过；真实旋转严格 bbox、frame、SVG、synthetic 与 finite halfzoom 兼容仍有阻塞。功能验证与视觉结论分列。本地候选，未安装、发布或集成。**

分支 `codex/design-studio/render-fidelity-r007-20261107`，基线 `c16d9440a40a7f401f3ca29818dc4328b2cca913`，已含前六轮。
证据根目录 `/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/`，下文证据均相对于该目录；`.tmp` 不提交。

## 授权边界与证据保全

已读 `CODESHELL.md`、`CONTRIBUTING.md`、R006 acceptance 与只读协调裁决
`/Users/admin/Documents/个人学习/代码学习/codeshell/.loop/design-render-fidelity/rounds/r006/review.md`。
复用本任务独占 worktree/branch/base；没有 fetch、push、PR、merge main、安装或发布。
只写本 cwd 的 Design Studio、必要 tests/docs 与本地临时证据。没有修改 Host、其他 Panel、用户稿、lock、安装包或共享账本，没有使用凭证、用户 tab 或向外部服务写入。

独立 `npm ci --cache .tmp/npm-cache` 成功，node_modules 非 symlink；只运行本地专属 Chromium、私有 context，并拒绝 fixture 外请求。
只读真实六页源 `/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`，
SHA-256 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`；lock SHA-256
`8a2b2e40ace2c66133f1b30cae29ff7fe9d535814ded523ec90d43093ba7b7ea`。
旧 R006 `.tmp/render-fidelity-r006/` 仅作只读输入；不重拍 baseline、不更新 golden。

## 本批规则与验收口径

旋转方向改用物理端点差 `d_end = (L_css * scale / 2) * abs(sin(dtheta)) <= .5 device px`，
`L_css` 是 HTML 吸附后的本地长边，`scale = zoom * DPR`。保留 raw 二阶矩方向与质心数据，
方向角不再单独设阈值；质心与 bbox/stroke、pixel、AA 门限保持原值。
负控必须拒绝 DPR2 的 30×1 CSS px 条 +2°（端点约 1.047 device px）和 1 device px translation。

生产仅支持无旋转祖先、非 instance/被引用 component 路径的旋转 painted leaf。
先按现有 LayoutUnit replay 得到 x/y/w/h，再分别 round world translation 与 local width/height（CSS px）。
旋转 pivot 为 `(round(xLU)+wLU/2, round(yLU)+hLU/2)`；保留作者 radius；不写回 node x/y、offset 或文档格式。
未支持路径明确 fallback。绘制、clip、正逆变换、命中与 cache 的最终证据列于下文。

frame 只有自身 geometry pass 且每个实际 mismatch pixel 均被实际失败 descendant 的 reference/actual ink bbox union +2 device px 覆盖，才可记 `DESCENDANT_ATTRIBUTED`。
原 mask、counter 和 raw failure 保留；未知、缺图和不可测不转 pass。
SVG precise 对 HTML 规则 e 的可预测误差仅在 residual <=.1 device px 时登记为诊断，不能整组跳过 SVG。

## 定向红绿、最终数据与兼容

### 旋转生产规则、负控和定向红绿

新实现复用 R006 spike e 的确切规则，没有节点特例或新增 magic offset。
`browserPaintBoxes` 返回 presentation clones 与 CSS px `rotationPivots` sidecar；CanvasKit 绘制/ancestor clip、
pointTo/from/corners/bounds 的可选 pivot、GPU active hit-test 共用该 sidecar。
默认文档几何 API 仍使用作者几何，作者 x/y/size/radius/offset 和序列化不变。
局部 node picture 缓存只缓存本地 paint，外层平移与 pivot 在 replay 时应用；unit/UI 验证 pivot 变化不会使用陈旧变换，
实际缓存命中与正逆 hit 保持正确。未支持祖先旋转路径保留明确 fallback reason。

红：新增 paint-box 资格/坐标断言在旧实现失败，见 `rotation/unit-red.log`。
绿：paint-box/interaction 15/15、pivot/cache/hit UI 1/1，见 `rotation/unit-green.log`、`cache-ui-green.log`。
相关 unit/UI 一次合跑 84/84，见 `rotation/related-checks.log`；生成 adapter `--check` 通过，无生成文件变化。

生产 spike 直接运行未注入修改的生产 renderer，复用原 16 case×DPR1/2，未重拍旧候选：
32/32 满足 centroid<=.1、area±2%、endpoint<=.5。最大 centroid `.03585955365995289` device px，
最大 endpoint `.04758467161398139` device px，area `.9970238095238095..1.015625`；
raw angle 最大 `1.8179055656752325°` 原值保留，不再独立按角度失败。
`rotation/spike.json` 保留每个 DOM computed matrix、unrotated box、LU replay、原矩和统计；
`rotation/dpr{1,2}-{html,production-e}.png` 为实际输出。根执行者实际打开了 DPR2 两图，未冒充 CC 签字。

测量红/绿日志在 `measurement/endpoint-frame-red.log`、`endpoint-frame-green.log`、
`svg-rotation-red.log`、`focused-green.log`，最终 focused 29/29。
DPR2 的 30×1 CSS px 条 +2°测得 endpoint `1.046984901075`，失败；真实 1 device px 平移仍被原 centroid `.5` 门限拒绝。
短条 raw 方向变化可通过 endpoint，但没有放宽 centroid、bbox、stroke 或 pixel。
缺少 local L、scale、geometry/gate arrays、HTML reference ink 的负控均不能获得 pass/归因。
旧 R006 1232 行端点离线重算在 `measurement/r006-endpoint-replay-registry.json`，
最大 endpoint `.292091` device px；只新增端点分析，旧 strict 与原 PNG 不改，不把旧行重称通过。

实际命令：

```sh
node --test tests/apps/design-studio/browser-paint-box.test.mjs tests/apps/design-studio/canvas-interaction.test.mjs
DESIGN_ROTATION_EVIDENCE=.tmp/render-fidelity-r007/rotation node tests/apps/design-studio/rotation-paint-box-spike.mjs
node --test tests/apps/design-studio/render-fidelity-attribution.test.mjs tests/apps/design-studio/render-fidelity-geometry.test.mjs tests/apps/design-studio/rotation-moment-roi.test.mjs
node scripts/build-design-studio-figma-plugin.mjs --check
```

### finite 原兼容合同：halfzoom 仍 BLOCKED

`finite/receipt.json` 的 `passed:false / status:BLOCKED` 保留逐项 checks；
`finite/compatibility.json` 保存旧 R005/R006 原始报告 SHA、PNG 路径、完整数值与离线计算。
没有重拍 baseline、更新 golden 或为 finite 扩大生产修改。

- DPR1/z1 原三个 GPU crop SHA 均不变；另外独立解码三张 GPU 和三张 SVG isolation PNG，
  旧新尺寸及完整 RGBA SHA 均相同。SVG exact string 三项均不同，但 hanging→measured alphabetic
  已满足协调裁决要求的 DPR1 SVG 像素保持条件。
- GPU scale≥1 的 9 项旧→新 phase+round 预测最大误差为 `2.5792701308091637e-12 device px`，均≤.1。
- native SVG DPR1/z2：旧 centroidY=`-.9999999999999147`、新=`0`，原预测 shift=`0`、实测 shift
  及预测误差=`.9999999999999147`、`certified:false` 全部原样保留。该路径按协调裁决单列接受为
  预测模型未覆盖的 CSS-zoom SVG hanging 路径，不能称预测通过。

halfzoom Arial 的 HTML reference crop SHA 旧新相同；下表是原 isolation 数据直接比较，单位为 device px：

| 节点 | 旧 centroid X / Y | 新 centroid X / Y | 旧→新二维质心误差 | 旧→新 raw mismatch / 分母 | cluster |
| --- | --- | --- | --- | --- | --- |
| finite-offset | -.1035458241 / -.0258065188 | -.2592613135 / -.0261138045 | .1067132331→.2605731365 | 163→147 / 5920 | 26→29 |
| finite-offset-negative | .1944769977 / .2895948043 | .3444880343 / -.2011233498 | .3488358543→.3989017519 | 135→137 / 6068 | 36→38 |

positive 的 mean absolute channel error 从 `1.3692567568` 改善为 `1.3240287162`，但两轴质心误差和
cluster 均变差；其绝对 Y 也从 `.0258065188` 增至 `.0261138045`。negative 的绝对 Y 改善，
但 X、二维质心、raw mismatch、cluster 和 mean absolute channel error（`1.5459789057→1.5894858273`）
均变差。因此“新 vs HTML 误差≤旧 vs HTML”条件不成立，不能接受两个 Arial halfzoom master 变化；
native halfzoom 所列指标全部不变。此项继续 **BLOCKED**，没有选择性只报改善的指标。
历史 R006 finite24 为24/24 strict geometry pass、unavailable0；本轮 fresh finite24 仍由最终 synthetic 收据独立裁定。

本轮只追加一个小型 UI 测试：144 个独立 DOM baseline marker 样本，覆盖 DPR1/2 × editor transform zoom1/2
× authored y phase .499/.5 × plain/fill/href range ×6行，全部匹配 measured finite paint baseline。
同一测试明确断言 GPU resource raster 仍排除 fill/href ranges，而 HTML 仍应用 finite transport。
它记录既有资格不一致，没有扩大 ranges 支持或宣称 GPU raster parity。multiline finite 的 DOM baseline
现已定向覆盖，实际 multiline GPU/SVG strict raster parity 仍未测。定向最终1/1通过；早期 fixture 缺字段及
误用 CSS zoom 的脚手架失败日志保留，不冒充生产 red/green。此兼容工作者未目视打开任何 PNG。

实际命令（从当前 worktree 执行；前后两个脚本 exit0仅代表离线派生成功，兼容状态仍为 BLOCKED）：

```sh
node .tmp/render-fidelity-r007/finite/verify-compatibility.mjs
DESIGN_FINITE_HTML_EVIDENCE="$PWD/.tmp/render-fidelity-r007/finite/targeted-ui" \
node --test --test-name-pattern='finite multiline DOM' tests/apps/design-studio/frontend-finite-origin-ui.test.mjs
node .tmp/render-fidelity-r007/finite/finalize-receipt.mjs
```

完整逐项证据与范围说明见 `finite/HANDOFF.md`、`finite/compatibility.json`、
`finite/targeted-ui/multiline-range-baselines.json` 和 `finite/targeted-ui-final.log`。

### synthetic 最终逐项残留

最终 strict4 unique 752（每 route 188），unavailable0、route error0；gate fail38（GPU18、SVG20）。
finite24 的24行 gate fail0，最终独立几何校验另见 `finite/final-strict24.json`。
只读 R006 对照证明38个失败键的 crop bytes、raw metrics、geometry/gate arrays 全相同，新增失败0、缺失0、旧失败转绿0。
既定限制单独项9，未解决真差异29，所有原门禁保留。
`measurement/synthetic-residuals.json` 提供每项完整失败数组、raw/AA/geometry、SHA 与真实图路径。
下表 D1/D2=DPR1/2，z=zoom，fpan=fractionalpan；限制标签不代表 pass。

| Matrix | Node / route / type | Gate failures (grouped) | Raw mismatch / cluster | Qualification | Classification | R006 |
| --- | --- | --- | --- | --- | --- | --- |
| D2/fpan | center-stroke / gpu / rectangle | stroke width 0.5 > .35; pixel mismatch 0.00602 > 0.001; pixel cluster 148 > 6 | 0.006024 / 148 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | center-stroke / svg / rectangle | stroke width 0.5 > .35; pixel mismatch 0.00602 > 0.001; pixel cluster 148 > 6 | 0.006024 / 148 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | fill-ellipse / gpu / ellipse | pixel mismatch 0.01231 > 0.001; pixel cluster 9 > 6 | 0.012315 / 9 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | fill-ellipse / gpu / ellipse | pixel mismatch 0.00899 > 0.001 | 0.008996 / 4 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | fill-ellipse / gpu / ellipse | pixel mismatch 0.01231 > 0.001; pixel cluster 9 > 6 | 0.012315 / 9 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z1 | fill-ellipse / svg / ellipse | pixel mismatch 0.02758 > 0.001; pixel cluster 9 > 6 | 0.027586 / 9 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | fill-ellipse / svg / ellipse | pixel mismatch 0.01280 > 0.001; pixel cluster 8 > 6 | 0.012808 / 8 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | fill-ellipse / svg / ellipse | shape left 1 > 0.5; shape right -1 > 0.5; pixel mismatch 0.01049 > 0.001; pixel cluster 8 > 6 | 0.010495 / 8 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | fill-ellipse / svg / ellipse | pixel mismatch 0.01280 > 0.001; pixel cluster 8 > 6 | 0.012808 / 8 | fail | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | legacy-parent / gpu / frame | stroke width 0.5 > .35; pixel mismatch 0.01698 > 0.001; pixel cluster 140 > 6; frame composite contains mismatches outside failed descendant bounds + 2 device px | 0.016986 / 140 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | legacy-parent / svg / frame | stroke width 0.5 > .35; pixel mismatch 0.01698 > 0.001; pixel cluster 140 > 6; frame composite contains mismatches outside failed descendant bounds + 2 device px | 0.016986 / 140 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | legacy-stroke / gpu / rectangle | stroke width 0.5 > .35; pixel mismatch 0.00561 > 0.001; pixel cluster 148 > 6 | 0.005612 / 148 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | legacy-stroke / svg / rectangle | stroke width 0.5 > .35; pixel mismatch 0.00561 > 0.001; pixel cluster 148 > 6 | 0.005612 / 148 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z1 | round-icon / svg / rectangle | stroke centroid -0.35400 > .35; stroke centroid 0.38689 > .35; stroke centroid 0.44281 > .35; stroke centroid 0.51064 > .35; stroke centroid 0.54745 > .35; stroke centroid 0.43313 > .35; stroke centroid 0.45514 > .35; stroke centroid 0.39019 > .35; stroke centroid -0.36556 > .35; stroke centroid -0.48664 > .35; stroke centroid -0.52432 > .35; stroke centroid -0.44147 > .35; stroke centroid -0.40888 > .35; pixel mismatch 0.04580 > 0.001; pixel cluster 11 > 6 | 0.045806 / 11 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | round-icon / svg / rectangle | stroke centroid -0.69855 > .35; stroke centroid -0.62388 > .35; stroke centroid -0.41012 > .35; stroke centroid 0.42936 > .35; stroke centroid 0.57517 > .35; stroke centroid 0.66159 > .35; stroke centroid 0.79456 > .35; stroke centroid 0.83028 > .35; stroke centroid 0.89215 > .35; stroke centroid 0.94259 > .35; stroke centroid 0.84186 > .35; stroke centroid 0.79537 > .35; stroke centroid 0.69669 > .35; stroke centroid 0.61775 > .35; stroke centroid 0.44504 > .35; stroke centroid -0.41672 > .35; stroke centroid -0.56953 > .35; stroke centroid -0.67529 > .35; stroke centroid -0.75306 > .35; stroke centroid -0.84921 > .35; stroke centroid -0.95483 > .35; stroke centroid -0.84942 > .35; stroke centroid -0.87729 > .35; stroke centroid -0.80320 > .35; pixel mismatch 0.03063 > 0.001; pixel cluster 18 > 6 | 0.030636 / 18 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | round-icon / svg / rectangle | stroke centroid -0.69732 > .35; stroke centroid -0.58929 > .35; stroke centroid -0.46988 > .35; stroke centroid 0.44446 > .35; stroke centroid 0.59026 > .35; stroke centroid 0.71285 > .35; stroke centroid 0.77715 > .35; stroke centroid 0.87569 > .35; stroke centroid 0.97235 > .35; stroke centroid 0.90965 > .35; stroke centroid 0.87684 > .35; stroke centroid 0.79570 > .35; stroke centroid 0.69761 > .35; stroke centroid 0.61844 > .35; stroke centroid 0.45536 > .35; stroke centroid -0.40232 > .35; stroke centroid -0.55394 > .35; stroke centroid -0.67792 > .35; stroke centroid -0.82776 > .35; stroke centroid -0.87535 > .35; stroke centroid -0.88325 > .35; stroke centroid -0.92636 > .35; stroke centroid -0.88600 > .35; stroke centroid -0.80176 > .35; pixel mismatch 0.03055 > 0.001; pixel cluster 18 > 6 | 0.030556 / 18 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | round-icon / svg / rectangle | stroke centroid -0.69855 > .35; stroke centroid -0.62388 > .35; stroke centroid -0.41012 > .35; stroke centroid 0.42936 > .35; stroke centroid 0.57517 > .35; stroke centroid 0.66159 > .35; stroke centroid 0.79456 > .35; stroke centroid 0.83028 > .35; stroke centroid 0.89215 > .35; stroke centroid 0.94259 > .35; stroke centroid 0.84186 > .35; stroke centroid 0.79537 > .35; stroke centroid 0.69669 > .35; stroke centroid 0.61775 > .35; stroke centroid 0.44504 > .35; stroke centroid -0.41672 > .35; stroke centroid -0.56953 > .35; stroke centroid -0.67529 > .35; stroke centroid -0.75306 > .35; stroke centroid -0.84921 > .35; stroke centroid -0.95483 > .35; stroke centroid -0.84942 > .35; stroke centroid -0.87729 > .35; stroke centroid -0.80320 > .35; pixel mismatch 0.03063 > 0.001; pixel cluster 18 > 6 | 0.030636 / 18 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z1 | selector / gpu / frame | pixel mismatch 0.00492 > 0.001 | 0.004926 / 2 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | selector / gpu / frame | pixel mismatch 0.00367 > 0.001 | 0.003678 / 3 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | selector / gpu / frame | pixel mismatch 0.02586 > 0.001; pixel cluster 114 > 6; frame composite contains mismatches outside failed descendant bounds + 2 device px | 0.025862 / 114 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | selector / gpu / frame | pixel mismatch 0.00367 > 0.001 | 0.003678 / 3 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z1 | selector / svg / frame | pixel mismatch 0.00492 > 0.001 | 0.004926 / 2 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | selector / svg / frame | pixel mismatch 0.00441 > 0.001 | 0.004413 / 3 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | selector / svg / frame | pixel mismatch 0.02586 > 0.001; pixel cluster 114 > 6; frame composite contains mismatches outside failed descendant bounds + 2 device px | 0.025862 / 114 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | selector / svg / frame | pixel mismatch 0.00441 > 0.001 | 0.004413 / 3 | ineligible-text-descendants | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z1 | shadow-stack / svg / rectangle | shape left 1 > 0.5; shape right -1 > 0.5; shape bottom -1 > 0.5; shape centroid 0.71191 > 0.5 | 0.000000 / 0 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | shadow-stack / svg / rectangle | shape left 1 > 0.5; shape right -1 > 0.5 | 0.000000 / 0 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/fpan | shadow / gpu / rectangle | stroke width 0.48880 > .35; pixel mismatch 0.00618 > 0.001; pixel cluster 140 > 6 | 0.006190 / 140 | ineligible-geometry | UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D1/z2 | shadow / svg / rectangle | shadow centroid 2.74557 > 1 | 0.000000 / 0 | ineligible-geometry | EXISTING_SVG_SHADOW_CENTROID | exact unchanged fail |
| D2/fpan | shadow / svg / rectangle | shadow centroid 1.58590 > 1; stroke width 0.48880 > .35; pixel mismatch 0.00618 > 0.001; pixel cluster 140 > 6 | 0.006190 / 140 | ineligible-geometry | EXISTING_SVG_SHADOW_CENTROID + UNRESOLVED_TRUE_DIFFERENCE | exact unchanged fail |
| D2/z1 | shadow / svg / rectangle | shadow centroid 2.74557 > 1 | 0.000000 / 0 | ineligible-geometry | EXISTING_SVG_SHADOW_CENTROID | exact unchanged fail |
| D1/z1 | ranges-plain / gpu / text | pixel mismatch 0.01982 > 0.005; pixel cluster 29 > 6 | 0.019828 / 29 | text: no shape AA | EXISTING_NATIVE_PLAIN_RANGES | exact unchanged fail |
| D1/z2 | ranges-plain / gpu / text | centroidY -0.79783 > 0.75; pixel mismatch 0.01093 > 0.005; pixel cluster 85 > 6 | 0.010940 / 85 | text: no shape AA | EXISTING_NATIVE_PLAIN_RANGES | exact unchanged fail |
| D2/fpan | ranges-plain / gpu / text | centroidY -0.78795 > 0.75; pixel mismatch 0.01175 > 0.005; pixel cluster 68 > 6 | 0.011754 / 68 | text: no shape AA | EXISTING_NATIVE_PLAIN_RANGES | exact unchanged fail |
| D2/z1 | ranges-plain / gpu / text | centroidY -0.79783 > 0.75; pixel mismatch 0.01093 > 0.005; pixel cluster 85 > 6 | 0.010940 / 85 | text: no shape AA | EXISTING_NATIVE_PLAIN_RANGES | exact unchanged fail |
| D1/z2 | stroke-text / gpu / text | pixel cluster 19 > 6 | 0.000344 / 19 | text: no shape AA | EXISTING_NATIVE_STROKED_TEXT | exact unchanged fail |
| D2/fpan | stroke-text / gpu / text | pixel cluster 18 > 6 | 0.000314 / 18 | text: no shape AA | EXISTING_NATIVE_STROKED_TEXT | exact unchanged fail |
| D2/z1 | stroke-text / gpu / text | pixel cluster 19 > 6 | 0.000344 / 19 | text: no shape AA | EXISTING_NATIVE_STROKED_TEXT | exact unchanged fail |

Grouped contour messages omit duplicate contour fractions only for readability; JSON preserves every original failure, raw metric, qualification object and source path. No screenshots were opened by this worker; these are measured-data findings.

### 诊断计数与冻结限制

SVG rule e 的归因原值保留在每条 `svgSnapClassification`，其 residual<=.1 只是预测诊断，
不能计 raw/strict pass。旋转最终 registry 在保守 bbox supplement 后再次核对同 identity 的 GPU/HTML strict+raw/AA，
独立列出 `strictPass`、`svgPredictedDiagnostic` 和两者的 accepted union。
raw report 的 legacy `fidelityCounts.svgPreciseSnap` counter 仍只统计历史 axis-aligned kind（在采集冻结后发现，未改 frozen source）；
最终 `summary.json` 直接由逐行 classification 重算总数，并分列 axis-aligned / rotation rule e，
raw source counter 与原始 report 不被回写。
旧 R005 专用 `rotation-residual-audit.mjs` 未迁移所需 L/scale metadata，若手工运行会明确 unavailable；
本轮旧数据端点分析使用新的 `summarize-rotation-final.mjs`，不将旧入口作为通过证据。

## 唯一最终数据与真实残留

最终 raw 捕获与分析入口均 create-only，source SHA/lock/测试源码在采集前后完全一致（`captureSourcePreserved:true`、sourceChanges/deletedSources均空、readOnlySourcePreserved:true）。
实际后处理命令如下；它们只读原 report/PNG，派生到新路径：

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r007/summarize-final.mjs final-synthetic
node --max-old-space-size=8192 .tmp/render-fidelity-r007/summarize-final.mjs final-real
node .tmp/render-fidelity-r007/summarize-fit.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r007/summarize-rotation-final.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r007/compare-frame-cohorts.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r007/summarize-measurement-final.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r007/assert-final.mjs
```

`assert-final.mjs` 实际 exit1，`strict-visual-final-assertion.json` 为 BLOCKED；失败检查：synthetic: strict effective geometry and gates、synthetic: text unchanged strict、real: strict effective geometry and gates、finite approved compatibility conditions、rotation strict or explicitly predicted SVG diagnostic。

真实 strict4 unique 10,176、完整覆盖10,176、partial0、duplicate0、unmeasured0、font omission0、route error0。
其中 text3712：geometry fail0、gate fail0、unavailable0。SVG text 仍保留1条 raw pixel-only 诊断，不能把 gate0 混称每项 raw pixel0。

| route | unique / effective | own-fill排除非pass | audited gate fail | geometry fail | raw pixel fail | AA qualified非raw | unavailable有效 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gpu | 2544 / 2468 | 76 | 326 | 255 | 327 | 162 | 0 |
| browser | 2544 / 2468 | 76 | 0 | 0 | 0 | 0 | 0 |
| svg | 2544 / 2468 | 76 | 572 | 749 | 813 | 57 | 0 |
| html | 2544 / 2468 | 76 | 0 | 0 | 0 | 0 | 0 |

上表是保留 late rotated bbox audit 后的逐行 snapshot，SVG diagnostic 的 GPU/HTML peer 资格还须最终复核；不将该 snapshot 当最终已接受合同。
原 capture 的 GPU 有效 geometry fail0、gate fail71，late bbox supplement 额外拒绝255条旋转，恢复原 pixel failure并撤销其 conditional AA，得到上述326；原 raw证据未改。
GPU326精确分组：255 rotation +64 frame composite +7已登记 geometry-pass radius seam。

### 77旋转节点：实验成功不外推真实 strict 成功

77×4严格矩阵×4 routes=1232行，全部逐节点 isolation、原 wide与bounded矩完整，missing/unavailable0。
GPU308行 strict 53/308，最大 centroid 0.157821056530、endpoint 0.093555522318 device px，area 0.925025007822..1.228952659976。
因此不满足 real77 strict geometry+raw/AA 合同；无需靠 raw angle判红，现有边界与像素门禁已真实失败。
SVG source坐标未改，capture 额外登记123条 rule-e预测诊断（axis-aligned233，总356）；late bbox后相应GPU peer资格失败，最终rotation registry接受的SVG预测诊断0，不能将123条当最终通过。
每项原角、endpoint、area、bbox、raw/AA、geometry/gate与PNG路径保存在 `rotation-final-registry.json`；下表是完整77节点压缩索引。

| 页 / 节点 | 源角° | GPU 最坏 c / θ / A | GPU 例外fail /4 | GPU strict /4 | SVG 最坏 c / θ / A | SVG 例外fail /4 | SVG strict /4 |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| web-chat / web-chat-96 | 40 | c 0.0594 / end 0.0698 / θ 1.1420 / A 1.0193–1.0484 | 0 | 0 | c 0.4005 / end 0.0309 / θ 0.5055 / A 1.3440–1.3563 | 0 | 0 |
| web-chat / web-chat-97 | -40 | c 0.0546 / end 0.0734 / θ 1.2017 / A 1.0237–1.0559 | 0 | 0 | c 0.3984 / end 0.0331 / θ 0.5413 / A 1.3455–1.3694 | 0 | 0 |
| web-chat / web-chat-110 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-111 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-chat / web-chat-160 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-161 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-chat / web-chat-166 | 45 | c 0.1102 / end 0.0918 / θ 1.9533 / A 1.0308–1.2265 | 0 | 0 | c 0.5914 / end 0.1474 / θ 4.2278 / A 1.0012–1.1711 | 3 | 0 |
| web-chat / web-chat-167 | -45 | c 0.1096 / end 0.0921 / θ 2.0875 / A 1.0305–1.2290 | 0 | 0 | c 0.5914 / end 0.1488 / θ 4.2679 / A 1.0012–1.1644 | 3 | 0 |
| web-chat / web-chat-170 | 45 | c 0.1102 / end 0.0918 / θ 1.9533 / A 1.0308–1.2265 | 0 | 0 | c 0.5914 / end 0.1474 / θ 4.2278 / A 1.0012–1.1711 | 3 | 0 |
| web-chat / web-chat-171 | -45 | c 0.1096 / end 0.0921 / θ 2.0875 / A 1.0305–1.2290 | 0 | 0 | c 0.5914 / end 0.1488 / θ 4.2679 / A 1.0012–1.1644 | 3 | 0 |
| web-chat / web-chat-193 | 40 | c 0.1379 / end 0.0934 / θ 2.6769 / A 1.0467–1.1133 | 0 | 0 | c 0.6370 / end 0.0888 / θ 2.5452 / A 0.8891–1.0104 | 3 | 0 |
| web-chat / web-chat-194 | -40 | c 0.1418 / end 0.0906 / θ 2.5967 / A 1.0483–1.0921 | 0 | 0 | c 1.4490 / end 0.2921 / θ 8.3978 / A 0.8646–0.8952 | 4 | 0 |
| web-chat / web-chat-16 | 40 | c 0.1578 / end 0.0444 / θ 0.8480 / A 1.0390–1.0607 | 0 | 1 | c 1.3251 / end 0.0624 / θ 1.1921 / A 1.3048–1.3554 | 4 | 0 |
| web-chat / web-chat-17 | -40 | c 0.0597 / end 0.0386 / θ 0.4354 / A 1.0309–1.0644 | 0 | 1 | c 0.3040 / end 0.0439 / θ 0.8393 / A 1.2960–1.3460 | 0 | 0 |
| web-chat / web-chat-31 | 45 | c 0.0724 / end 0.0143 / θ 0.1634 / A 1.0205–1.1222 | 0 | 0 | c 0.6940 / end 0.0222 / θ 0.5096 / A 1.2599–1.4173 | 3 | 0 |
| web-chat / web-chat-32 | -45 | c 0.1111 / end 0.0086 / θ 0.0984 / A 1.0285–1.1530 | 0 | 0 | c 0.9974 / end 0.0435 / θ 0.4986 / A 1.2041–1.3909 | 3 | 0 |
| web-chat / web-chat-36 | 45 | c 0.0479 / end 0.0265 / θ 0.3035 / A 0.9946–1.0541 | 0 | 1 | c 1.1584 / end 0.0517 / θ 1.1843 / A 0.8962–0.9944 | 4 | 0 |
| web-chat / web-chat-37 | -45 | c 0.0459 / end 0.0237 / θ 0.2711 / A 0.9893–1.0559 | 0 | 1 | c 0.3125 / end 0.0208 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| web-chat / web-chat-43 | 45 | c 0.0648 / end 0.0252 / θ 0.6267 / A 1.0408–1.1370 | 0 | 3 | c 0.7530 / end 0.0420 / θ 1.6036 / A 1.3088–1.3381 | 3 | 1 |
| web-chat / web-chat-44 | -45 | c 0.0469 / end 0.0250 / θ 0.3141 / A 0.9250–1.0892 | 0 | 1 | c 0.8876 / end 0.0432 / θ 0.9910 / A 1.0878–1.2470 | 3 | 0 |
| web-chat / web-chat-55 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-56 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-chat / web-chat-78 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-79 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-chat / web-chat-83 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-84 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| ios-chat / ios-chat-32 | 40 | c 0.1049 / end 0.0446 / θ 0.4262 / A 1.0440–1.0650 | 0 | 1 | c 0.7035 / end 0.0653 / θ 1.2464 / A 1.0365–1.0666 | 3 | 0 |
| ios-chat / ios-chat-33 | -40 | c 0.1462 / end 0.0321 / θ 0.6134 / A 1.0351–1.0539 | 0 | 1 | c 0.5593 / end 0.0171 / θ 0.2918 / A 1.0067–1.0403 | 3 | 0 |
| ios-chat / ios-chat-41 | 45 | c 0.0724 / end 0.0143 / θ 0.1634 / A 1.0205–1.1222 | 0 | 0 | c 0.6940 / end 0.0222 / θ 0.5096 / A 1.2599–1.4173 | 3 | 0 |
| ios-chat / ios-chat-42 | -45 | c 0.1111 / end 0.0086 / θ 0.0984 / A 1.0285–1.1530 | 0 | 0 | c 0.9974 / end 0.0435 / θ 0.4986 / A 1.2041–1.3909 | 3 | 0 |
| ios-chat / ios-chat-46 | 45 | c 0.0479 / end 0.0265 / θ 0.3035 / A 0.9946–1.0541 | 0 | 1 | c 1.1584 / end 0.0456 / θ 1.0447 / A 0.8883–0.9944 | 4 | 0 |
| ios-chat / ios-chat-47 | -45 | c 0.0459 / end 0.0237 / θ 0.2711 / A 0.9893–1.0559 | 0 | 1 | c 0.3125 / end 0.0208 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| ios-chat / ios-chat-53 | 45 | c 0.0648 / end 0.0252 / θ 0.6267 / A 1.0408–1.1370 | 0 | 3 | c 0.7530 / end 0.0420 / θ 1.6036 / A 1.3088–1.3381 | 3 | 1 |
| ios-chat / ios-chat-54 | -45 | c 0.0469 / end 0.0250 / θ 0.3141 / A 0.9250–1.0892 | 0 | 1 | c 0.8876 / end 0.0432 / θ 0.9910 / A 1.0878–1.2470 | 3 | 0 |
| ios-chat / ios-chat-65 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-chat / ios-chat-66 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| ios-chat / ios-chat-77 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-chat / ios-chat-78 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| ios-chat / ios-chat-82 | 40 | c 0.1410 / end 0.0936 / θ 2.6811 / A 1.0470–1.1135 | 0 | 0 | c 0.6374 / end 0.0869 / θ 2.4892 / A 0.8891–1.0125 | 3 | 0 |
| ios-chat / ios-chat-83 | -40 | c 0.1402 / end 0.0931 / θ 2.6691 / A 1.0482–1.0913 | 0 | 0 | c 1.4533 / end 0.2902 / θ 8.3440 / A 0.8642–0.8968 | 4 | 0 |
| android-chat / android-chat-33 | 40 | c 0.1049 / end 0.0446 / θ 0.4262 / A 1.0440–1.0650 | 0 | 1 | c 0.7035 / end 0.0653 / θ 1.2464 / A 1.0365–1.0666 | 3 | 0 |
| android-chat / android-chat-34 | -40 | c 0.1462 / end 0.0321 / θ 0.6134 / A 1.0351–1.0539 | 0 | 1 | c 0.5593 / end 0.0171 / θ 0.2918 / A 1.0067–1.0403 | 3 | 0 |
| android-chat / android-chat-42 | 45 | c 0.0724 / end 0.0143 / θ 0.1634 / A 1.0205–1.1222 | 0 | 0 | c 0.6940 / end 0.0222 / θ 0.5096 / A 1.2599–1.4173 | 3 | 0 |
| android-chat / android-chat-43 | -45 | c 0.1111 / end 0.0086 / θ 0.0984 / A 1.0285–1.1530 | 0 | 0 | c 0.9974 / end 0.0435 / θ 0.4986 / A 1.2041–1.3909 | 3 | 0 |
| android-chat / android-chat-47 | 45 | c 0.0479 / end 0.0265 / θ 0.3035 / A 0.9946–1.0541 | 0 | 1 | c 1.1584 / end 0.0456 / θ 1.0447 / A 0.8883–0.9944 | 4 | 0 |
| android-chat / android-chat-48 | -45 | c 0.0459 / end 0.0237 / θ 0.2711 / A 0.9893–1.0559 | 0 | 1 | c 0.3125 / end 0.0208 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| android-chat / android-chat-54 | 45 | c 0.0648 / end 0.0252 / θ 0.6267 / A 1.0408–1.1370 | 0 | 3 | c 0.7530 / end 0.0420 / θ 1.6036 / A 1.3088–1.3381 | 3 | 1 |
| android-chat / android-chat-55 | -45 | c 0.0469 / end 0.0250 / θ 0.3141 / A 0.9250–1.0892 | 0 | 1 | c 0.8876 / end 0.0432 / θ 0.9910 / A 1.0878–1.2470 | 3 | 0 |
| android-chat / android-chat-66 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-chat / android-chat-67 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| android-chat / android-chat-78 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-chat / android-chat-79 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| android-chat / android-chat-83 | 40 | c 0.1410 / end 0.0936 / θ 2.6811 / A 1.0470–1.1135 | 0 | 0 | c 0.6374 / end 0.0869 / θ 2.4892 / A 0.8891–1.0125 | 3 | 0 |
| android-chat / android-chat-84 | -40 | c 0.1402 / end 0.0931 / θ 2.6691 / A 1.0482–1.0913 | 0 | 0 | c 1.4533 / end 0.2902 / θ 8.3440 / A 0.8642–0.8968 | 4 | 0 |
| web-panels / web-panels-99 | 40 | c 0.0594 / end 0.0698 / θ 1.1420 / A 1.0193–1.0484 | 0 | 0 | c 0.4005 / end 0.0309 / θ 0.5055 / A 1.3440–1.3563 | 0 | 0 |
| web-panels / web-panels-100 | -40 | c 0.0546 / end 0.0734 / θ 1.2017 / A 1.0237–1.0559 | 0 | 0 | c 0.3984 / end 0.0331 / θ 0.5413 / A 1.3455–1.3694 | 0 | 0 |
| web-panels / web-panels-113 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-114 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-panels / web-panels-163 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-164 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-panels / web-panels-169 | 45 | c 0.1102 / end 0.0918 / θ 1.9533 / A 1.0308–1.2265 | 0 | 0 | c 0.5914 / end 0.1474 / θ 4.2278 / A 1.0012–1.1711 | 3 | 0 |
| web-panels / web-panels-170 | -45 | c 0.1096 / end 0.0921 / θ 2.0875 / A 1.0305–1.2290 | 0 | 0 | c 0.5914 / end 0.1488 / θ 4.2679 / A 1.0012–1.1644 | 3 | 0 |
| web-panels / web-panels-173 | 45 | c 0.1102 / end 0.0918 / θ 1.9533 / A 1.0308–1.2265 | 0 | 0 | c 0.5914 / end 0.1474 / θ 4.2278 / A 1.0012–1.1711 | 3 | 0 |
| web-panels / web-panels-174 | -45 | c 0.1096 / end 0.0921 / θ 2.0875 / A 1.0305–1.2290 | 0 | 0 | c 0.5914 / end 0.1488 / θ 4.2679 / A 1.0012–1.1644 | 3 | 0 |
| web-panels / web-panels-196 | 40 | c 0.1379 / end 0.0934 / θ 2.6769 / A 1.0467–1.1133 | 0 | 0 | c 0.6370 / end 0.0888 / θ 2.5452 / A 0.8891–1.0104 | 3 | 0 |
| web-panels / web-panels-197 | -40 | c 0.1418 / end 0.0906 / θ 2.5967 / A 1.0483–1.0921 | 0 | 0 | c 1.4490 / end 0.2921 / θ 8.3978 / A 0.8646–0.8952 | 4 | 0 |
| web-panels / web-panels-17 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-18 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| web-panels / web-panels-36 | 45 | c 0.0949 / end 0.0247 / θ 0.5668 / A 0.9857–1.0768 | 0 | 1 | c 1.1330 / end 0.0146 / θ 0.1670 / A 1.0197–1.0687 | 4 | 0 |
| web-panels / web-panels-93 | 45 | c 0.1102 / end 0.0918 / θ 1.9533 / A 1.0308–1.2265 | 0 | 0 | c 0.5914 / end 0.1474 / θ 4.2278 / A 1.0012–1.1711 | 3 | 0 |
| web-panels / web-panels-94 | -45 | c 0.1096 / end 0.0921 / θ 2.0875 / A 1.0305–1.2290 | 0 | 0 | c 0.5914 / end 0.1488 / θ 4.2679 / A 1.0012–1.1644 | 3 | 0 |
| ios-panels / ios-panels-37 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-panels / ios-panels-38 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| ios-panels / ios-panels-47 | 45 | c 0.0731 / end 0.0148 / θ 0.1699 / A 1.0208–1.1157 | 0 | 0 | c 0.5279 / end 0.0375 / θ 0.6242 / A 1.2633–1.4240 | 1 | 0 |
| android-panels / android-panels-38 | 40 | c 0.0861 / end 0.0859 / θ 2.4629 / A 1.0457–1.1263 | 0 | 1 | c 1.1177 / end 0.1345 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-panels / android-panels-39 | -40 | c 0.0867 / end 0.0851 / θ 2.4400 / A 1.0401–1.1116 | 0 | 1 | c 0.7628 / end 0.1435 / θ 4.1146 / A 1.0431–1.0619 | 3 | 0 |
| android-panels / android-panels-48 | 45 | c 0.0731 / end 0.0148 / θ 0.1699 / A 1.0208–1.1157 | 0 | 0 | c 0.5279 / end 0.0375 / θ 0.6242 / A 1.2633–1.4240 | 1 | 0 |

超界分因（每个原因独立计数，同一行可多因）：

- CENTROID_ABOVE_0_5_DEVICE_PX: 226

联合旧1px登记分因（bbox/原ink centroid/bounded rotation centroid；不包含方向规则）：

- INK_CENTROID_ABOVE_1_DEVICE_PX: 75
- ROTATION_CENTROID_ABOVE_1_DEVICE_PX: 69
- BBOX_ABOVE_1_DEVICE_PX: 18

### 真实旋转的覆盖缺口与最终peer合同

只读分析 `rotation/final-production-analysis.{json,md}` 证明77/77确实 eligible、pivot sidecar 注册、rotation fallback0。
该分析重放纯几何 eligibility，没有新渲染。生产采集的其余fallback为232个 unsupported-type，不能误称旋转仍走旧fallback。
保守bbox审计前 GPU308/308 gate pass（122 raw、186 AA）；审计后53/308（6 geometry+raw、47 geometry+AA）。
255条均增加向外1device px的bbox失败，centroid/endpoint失败0；139条原非raw AA被撤销，另116条原raw-pass仍因geometry失败被拒。
失败边 occurrence 可重叠：left−1有90、top−1有177、right+1有110、bottom+1有170。
恢复的原pixel mismatch139条、cluster12条可重叠；没有修改它们的原像素。

关键覆盖缺口：真实77条全部有正作者radius，32 spike全部radius0（黑白）。
最坏area1.228952659976来自 DPR1/z1 的 `web-chat-167/web-chat-171/web-panels-170/web-panels-174`：
作者4.2×1、radius .42、−45°，paint4×1，HTML mass约3.7914 / GPU约4.65945（精确原值在JSON），centroid .06478、endpoint .07285，bbox top−1/bottom+1。
现有证据支持仍有圆角/AA coverage差异的解释，但未隔离确定的渲染根因；不更改authorradius、不加入特例、不放宽edge门限。
因此 e 是已实施、测得改善的局部规则，不是 real77 strict完成。

`measurement/final-peer-guard.json` 在所有 late audit 后检查全部SVG classification，保留原始 report并只派生合同计数。
233条axis-aligned预测诊断保持有效；123条rule e全部因GPU geometry/gate失败撤销（80条还失去raw/qualifiedAA资格）。
全部123条恢复原失败，不能把早期分类当最终SVG放行。Synthetic4条既有axis诊断全部有效，38条失败不变。

| route | unique / effective | audited snapshot有效gatefail | 最终peer合同有效gatefail |
| --- | ---: | ---: | ---: |
| total | 10176 / 9872 | 898 | 1021 |
| GPU | 2544 / 2468 | 326 | 326 |
| browser | 2544 / 2468 | 0 | 0 |
| SVG | 2544 / 2468 | 572 | 695 |
| HTML | 2544 / 2468 | 0 | 0 |

raw gate总计含304条own-fill排除项，从1202增至1325；排除项仍不是pass。
最终 `strict-contract-final-assertion.json` / `.log` 为 **BLOCKED、exit1**，在原独立断言基础上补入peer合同与source SHA保全检查。
原classification、preSvg failures、geometry、rawpixel和qualification对象均逐项复制保留，未回写原report。
新增实际只读命令：

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r007/rotation/analyze-final.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r007/measurement/final-peer-guard.mjs
node .tmp/render-fidelity-r007/assert-contract.mjs
```

### frame / SVG 离线归因与旧未知 cohort

fresh有效frame composite raw失败共265（own-fill排除非pass）：GPU64、SVG201；均有完整 mismatch mask。GPU64全部仍未知；SVG44 descendant-attributed非raw、157仍未知（含4自身geometry不通过）。
归因算法现在自身geometry不通过即拒绝；实际failed descendant必须有reference与actual ink，不能missing fallback，也不能用只有composite失败的大frame解释祖先。
frame逐像素mask/covered/uncovered counter在各raw report，完整归因行在 `final-measurement-summary.json`。

| R006未知身份cohort | 全部匹配 | fresh raw composite pass | 仍未知fail | 自身geometry fail | missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPU72 | 72 | 18 | 54 | 0 | 0 |
| SVG113 | 113 | 0 | 111 | 2 | 0 |

此外fresh还有10条GPU未知来自旧cohort外，故总未知64；不能只报告54。SVG total未知157也不能用113旧cohort替代。
身份、counter、原图路径见 `r006-frame-cohort-comparison.json`，没有把missing或same-fill转pass。

### 机械 own-fill 与7条seam逐项

OWN_FILL_UNOBSERVABLE仅机械排除304行=19节点×4矩阵×4routes；raw unavailable与失败保留，每route排除76，不计pass。

| 页 / 节点 | strict4×routes行数 |
| --- | ---: |
| android-chat / android-chat-10 | 16 |
| android-chat / android-chat-23 | 16 |
| android-chat / android-chat-32 | 16 |
| android-chat / android-chat-59 | 16 |
| android-panels / android-panels-10 | 16 |
| android-panels / android-panels-23 | 16 |
| android-panels / android-panels-32 | 16 |
| ios-chat / ios-chat-22 | 16 |
| ios-chat / ios-chat-31 | 16 |
| ios-chat / ios-chat-58 | 16 |
| ios-chat / ios-chat-9 | 16 |
| ios-panels / ios-panels-22 | 16 |
| ios-panels / ios-panels-31 | 16 |
| ios-panels / ios-panels-9 | 16 |
| web-chat / web-chat-11 | 16 |
| web-chat / web-chat-198 | 16 |
| web-chat / web-chat-48 | 16 |
| web-panels / web-panels-11 | 16 |
| web-panels / web-panels-201 | 16 |

下列7条都是 DPR2 fractionalpan / GPU，geometry pass；raw/AA pixel门禁仍红，只保留既有1px作者圆角双阴影接缝登记，不扩充圆角例外：

| matrix / 节点 | geometry | raw mismatch ratio | cluster | stroke centroid / width 最大 device px |
| --- | --- | ---: | ---: | --- |
| dpr2-zoom1-fractionalpan / android-chat-53 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |
| dpr2-zoom1-fractionalpan / android-chat-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / android-panels-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / ios-chat-52 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |
| dpr2-zoom1-fractionalpan / ios-chat-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / ios-panels-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / web-chat-42 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |

本轮重新核对上述7项，raw mismatch、cluster与stroke maxima均与表中一致；完整当前值在final audited report。

### fit诊断与实际像素观察

fit七文字28条隔离诊断：gate failure0、unavailable0、route error0，最大device相位残差 1.13686837721616e-13；逐项DOM layout proof preserved。
fit仍是诊断，不以这28行替代全产品fit验收。

| 实际打开的fresh图 | 本轮证据路径 | 观察与限制 |
| --- | --- | --- |
| z2 sidebar raw GPU/HTML | `visual/z2-sidebar-{gpu-e,html}-raw.png` | 根执行者与独立工作者实际打开，完整标志和selector保留 |
| z2 chevron和>_ | `visual/z2-{chevron,mark}-{gpu-e,html,gpu-old-a}-{raw,nearest8x}.png` | e比旧a明显减轻粗轮廓，接近HTML但边缘覆盖仍不同；8x仅无插值复制原像素 |
| DPR2 fractionalpan正常GUI | `real-shard-1/dpr2-zoom1-fractionalpan-web-chat-0/{gpu,browser}-editor-gui.png` | 根执行者实际打开；zoom1、pan40.75/44、DPR2、stage1069×919，trusted delta3.25仅一次，无截图前校正 |
| 实际fit正常GUI | `real-shard-1/dpr1-fit-view-web-chat-{gpu,browser}-actual-fit-gui.png` | 根执行者实际打开；显示66%，actualzoom.65625、pan62/131.375，stage1069×919；两路布局/正文目视接近，strict红不被覆盖 |
| 生产32小实验 | `rotation/dpr2-{production-e,html}.png` | 根执行者实际打开两张，不外推真实77通过 |

原始z2 pixel crop：

![GPU e 原始sidebar crop](../../.tmp/render-fidelity-r007/visual/z2-sidebar-gpu-e-raw.png)

![HTML 原始sidebar crop](../../.tmp/render-fidelity-r007/visual/z2-sidebar-html-raw.png)

`visual/crop-receipt.json`保存source SHA、世界坐标与精确RGBA裁切位置；旧a只读。
`visual/independent-review.md`为独立工作者实际观察，不是外部CC签字。
未逐页目视其余五页全部GUI，也未人工打开全部1232旋转图；对应结论依据完整测量。正常GUI的fake Host无Agent会话提示仍保留，不能证明真实Host persistence。
后续CC仍需对本地候选独立review，本轮不声称CC已批准。

## 验证与交付

最终仅执行一份 real strict4 + synthetic + fit diagnostic 的采集；真实六页按三个互不重叠页组分片，
所有 raw report/PNG 保留，copy-only 合并后重算 unique identities。采集 diagnostic exit0 仅代表采集完成，不代表视觉通过。
主矩阵为 `dpr1-zoom1,dpr2-zoom1,dpr1-zoom2,dpr2-zoom1-fractionalpan`，fit 单列。

源码冻结后，采集 runner 与功能验证 runner 独立运行；采集内部仅三个互不重叠页组并行，验证 runner 按下列命令顺序执行。

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r007/run-final-capture.mjs
node .tmp/render-fidelity-r007/run-validation.mjs final
# validation runner 实际执行（专属 TMPDIR，详见 receipt）
npm test -- --suite design-studio
npm run check
npm run validate
```

每个主采集的完整参数为：

```sh
DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_ISOLATE_TEXT=1 \
DESIGN_FIDELITY_MATRIX=dpr1-zoom1,dpr2-zoom1,dpr1-zoom2,dpr2-zoom1-fractionalpan,dpr1-fit-view \
DESIGN_FIDELITY_APP_DIR="$PWD/apps/design-studio/app" \
DESIGN_FIDELITY_EVIDENCE="$PWD/.tmp/render-fidelity-r007/<kind>" \
TMPDIR="$PWD/.tmp/render-fidelity-r007/tmp" \
node --max-old-space-size=8192 --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
```

synthetic 的 REAL_FIXTURE/PAGES/TARGET_IDS 显式为空；real 三 shard 设置只读六页文件和页组
`web-chat,ios-chat` / `android-chat,web-panels` / `ios-panels,android-panels`，TARGET_IDS 为空。
fit-isolated 只设 matrix=`dpr1-fit-view`、相同真实源、targets=
`android-chat-5,android-panels-5,android-chat-103,android-chat-46,android-panels-33,web-chat-190,web-panels-193`。
没有另外重拍 halfzoom 或旧 baseline。

精确 commands/env/UTC/exit/log SHA 由 `final-capture-receipt.json` 与 `validation-final-receipt.json` 保存。
最终功能验证全部实际执行成功；无功能失败需要重跑，没有重复最终大矩阵：

| 检查 | tests | pass | fail | skip | exit / log |
| --- | ---: | ---: | ---: | ---: | --- |
| `npm test -- --suite design-studio` | 1479 | 1474 | 0 | 5 | 0 / `design-suite-final.log` |
| `npm run check`（含完整Design Studio suite） | 4077 | 4068 | 0 | 9 | 0 / `check-final.log` |
| `npm run validate` | — | — | 0 | — | 0 / `validate-final.log` |

精确执行时间：suite 2026-11-06T23:09:36.528Z–23:19:00.147Z，check 23:19:00.150Z–23:31:30.719Z，validate 23:31:30.730Z–23:31:33.957Z。
生成adapter `--check` 全绿，无生成产物差异。`final-custody.json`在所有验证完成后再次核对 app/tests/lock/package 全部SHA与冻结manifest完全一致，changes=[]，只读六页SHA也不变。
`git diff --check`通过。上述功能绿不覆盖 strict 红。只有真实可见旋转消除且其余门禁满足才可宣告六页 close；否则交付 BLOCKED checkpoint。

尚未完成范围始终包括 Node SVG central/fallback、ellipse/image fit 等全产品未覆盖路径；
本地候选不代表用户正在使用的 0.23.0 已更新，后续仍需 CC 独立 review。
任务 commit SHA 与 diffstat 记录在最终回复及本地 delivery receipt，避免本文自引用 SHA。


## 本批停止点与未完成项

本批交付可复审的实现与证据 checkpoint，六页**不close**。主要未完成项：真实圆角旋转255条GPU strict bbox失败、SVG合同695条有效gate失败、frame未知GPU64/SVG157、synthetic38条原失败（含29真差异）、两个Arial halfzoom兼容退化。
主3712文字gate0、finite24严格geometry通过、routeerror0保持；不是全产品或所有raw pixel一致的承诺。
已登记的same-fill、7条seam、native plain ranges/strokedtext与SVGshadow都逐项保留；不把它们泛化成新例外。
multiline只补DOM baseline/范围资格的144行测试，GPU/SVG multiline raster parity仍未测；finite fill/link ranges资格差异仍明确存在。
SVG Node无browser测量的central/hanging fallback、ellipse/image fit等未覆盖产品路径未扩展；旧分析入口L/scale metadata迁移也未做。
没有更新golden、发版、安装、更新用户正在用的0.23.0或把任务分支集成；后续仍需CC独立review。
资源用于这批测得规则、定向红绿和最后必要验证后停止新增扩展，保持全部红证据，不继续耗预算追逐绿色。
