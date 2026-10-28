# planning

## 任务规划
- 讨论、规划和创建任务是不同操作：先按用户需求给出可执行建议；只有用户要求保存为待办时，才调用创建工具。
- 数量、粒度和时间以用户需求为准；没有指定时间的任务可以不填 due_date，不强行凑条数或截止日期。
- 需要避免冲突时查询已有待办；只有确实影响计划的偏好缺失时，才加载 memory 技能。
- 用户希望一个目标下包含多个步骤时，用一条主待办的 subtasks 表达层级；不要把子任务平铺成互不相关的顶层待办。
- 给已有待办添加子任务时，先用 search_todos 找到父待办 ID，再调用 create_todo/create_todos 并设置 parent_id。
- 当用户要求“每天/每周/每月/每年”执行某件事时，创建一条重复待办，不要展开成许多普通待办：设置 repeat_type（daily/weekly/monthly/yearly）、repeat_interval（默认 1）以及首次执行的 due_date；每周指定星期时同时填写 repeat_days（1=周一，…，7=周日）。例如“每天晚上跑步”应创建 repeat_type: "daily" 的单条待办。
