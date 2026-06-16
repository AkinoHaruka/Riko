/**
 * 设置模块入口。导出设置相关的类型、数据访问函数和业务函数。
 * 设置模块管理用户配置（模型选择、温度等）、API Key 加密存储、功能开关和参数配置。
 */
export type {
  Setting,
  SettingRequest,
  ApiKeyRequest,
  SaveSettingResult,
  ParamKey,
  ParamConfig,
} from './types.js';
export { findByKey, findByKeys, findAllByUserId, upsert, deleteByKey } from './repository.js';
export {
  saveSetting,
  batchSaveSettings,
  getSetting,
  getAllSettings,
  getApiKey,
  saveApiKey,
  deleteSetting,
  getFeatureToggles,
  isFeatureEnabled,
  PARAM_KEYS,
  PARAM_DEFAULTS,
  PARAM_CONFIGS,
  getParamValue,
  getParamNumber,
  getParamNumberWithDefault,
  getAllParams,
  batchUpdateParams,
  getSettingsPageData,
} from './service.js';
export type { FeatureToggles } from './service.js';
