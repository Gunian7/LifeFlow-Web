# LifeFlow — Warm System 视觉规范 v2

## 定位

LifeFlow 是一个高度理性、可靠、系统化的时间工具，但服务的是一个真实的人。

视觉目标：

> 它很聪明，但没有试图证明自己很聪明。

参考气质：克制的系统感、生活温度、功能主义、网格纪律与编辑排版感。不得直接复制任何作品的视觉资产。

## 视觉关键词

Warm System · Calm · Human · Systematic · Editorial · Quietly Intelligent · Precise · Functional · Restrained · Spacious · Timeless

禁止：Cyberpunk、霓虹、玻璃拟态、紫色 AI 渐变、大面积渐变、过度圆角、阴影卡片墙、游戏 HUD、拟物、效率压迫、Gamification、数据炫技。

## 皮肤系统

LifeFlow 支持多套视觉皮肤。皮肤只改变表现层，不改变任务、Planner、Replan、重复规则、数据所有权或 AI 边界。

当前皮肤：

- **Warm System**：默认皮肤。暖白、结构线、克制橙色，表达温暖与精确的平衡。
- **Quiet Dark**：深炭灰、低刺激暖白和低饱和状态色，适合夜间使用。
- **Paper Editorial**：纸张色、编辑排版感、极少圆角，强调个人工作台气质。

皮肤选择保存在本地设备。未知或损坏的皮肤值必须安全回退到 Warm System。新增皮肤必须保持相同的语义色角色：当前任务、主要行动、成功、警告、错误和信息，不得仅按装饰颜色自由扩展。

## 色彩

```text
Background       #F5F3EE
Content          #FAF9F6
Primary          #1C1C1A
Secondary        #77756F
Tertiary         #A6A39B
Border           #DDDAD2
Accent           #E87532
Success          #6F8B72
Warning          #B08A52
Error            #A86458
Info             #71869A
```

Accent 只用于当前任务、当前时间、主要行动和少量重要状态。

## 排版

- LifeFlow：32–40px，600，letter-spacing -0.03em
- 日期：明显小于标题，使用 Secondary
- 时间：tabular numerals，作为时间线的视觉锚点
- 文字优先，装饰退后
- 不使用营销型巨大标题

## 布局

### Desktop

```text
┌──────────────────────────────────────────────────────┐
│ LifeFlow                              Replan  More   │
│ 日期                                                 │
├──────────────┬──────────────────────┬────────────────┤
│ Current      │ Today's Timeline     │ Task Detail    │
│ / Next       │                      │ Why here?      │
│ Unscheduled  │                      │ What changes?  │
│ Inbox        │                      │ AI optional    │
└──────────────┴──────────────────────┴────────────────┘
```

三个区域不是三个浮起的 Card，而是统一工作台，通过细边框、分隔线、间距和排版建立结构。

### Mobile

移动端使用单列：LifeFlow → 日期 → 当前/下一步 → 时间线 → 未排入 → 详情抽屉/面板。

所有内容从左上角开始编排，禁止 Hero 居中、空状态垂直居中和首屏无目的大留白。

## 时间线

时间线是页面的视觉主轴，不是普通 Todo List。

- 普通任务：灰 / 蓝灰结构
- 当前任务：极细橙色左侧指示线 + 极轻暖橙背景
- 时间刻度：细结构线与 tabular numerals
- 休息、睡眠、吃饭、缓冲：正式时间内容，视觉权重低但不能伪装成空白
- 不使用厚重彩色块、强烈阴影或闪烁

## 解释面板

右侧详情回答“为什么这件事现在出现在这里？”：时间、截止、原因、影响、可选动作。

它不是 AI 聊天窗口。AI 只能作为安静的可选建议，并且不能绕过本地 Planner。

## 状态与错误

未排入不是失败列表。用“未排入与原因”表达时间不足、休息保护、冲突和取舍。

错误必须诚实但不羞辱；不出现失败、落后、生产力损失等词。

## 组件

- border：1px `#DDDAD2`
- radius：4–8px，时间线关键区域可用 0px
- shadow：默认无，只有浮层使用极轻阴影
- 图标：单色细线几何风格
- 动效：150–250ms ease-out，只帮助理解状态变化

## 验收

每次视觉改动都要检查：页面是否从左上角开始、时间线是否仍是主轴、当前任务是否唯一突出、休息是否被视为正式计划、空状态是否提供方向、未排入是否不制造羞耻。
