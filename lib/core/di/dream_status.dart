/// 梦境整理任务的状态枚举
///
/// idle: 空闲状态，无任务执行
/// running: 正在运行整理任务
/// completed: 整理完成，等待 5 秒自动清除提示
enum DreamStatus { idle, running, completed }
