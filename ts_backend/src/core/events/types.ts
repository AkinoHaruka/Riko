/** WebSocket 广播事件的基本结构 */
export interface EventMessage {
  type: string;
  payload: unknown;
}
