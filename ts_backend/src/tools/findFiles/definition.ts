export function buildFindToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'find_tool',
      description: '按glob模式查找文件，支持通配符如**/*.md，结果按修改时间排序',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: { type: 'string' as const, description: 'glob模式，如**/*.md或*.txt' },
          path: {
            type: 'string' as const,
            description: '搜索范围（相对路径，空=根目录）',
            default: '',
          },
          limit: { type: 'integer' as const, description: '返回结果数量限制', default: 100 },
          offset: { type: 'integer' as const, description: '分页偏移', default: 0 },
        },
        required: ['pattern'],
      },
    },
  };
}
