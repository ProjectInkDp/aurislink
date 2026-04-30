export interface RoutePlannerConfig {
  enabled: boolean
  ipPool: string[]                          // list of outbound IPs to rotate
  strategy?: 'RotateOnBan' | 'LoadBalance' | 'NanoSwitch'
  cooldownMs?: number                       // how long a banned IP stays blocked (default: 600000)
}
