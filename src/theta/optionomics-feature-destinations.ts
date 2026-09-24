export type OptionomicsFeatureFamily =
  | 'CONTRACT' | 'QUOTE' | 'GREEKS' | 'LIQUIDITY' | 'VOLATILITY' | 'SKEW' | 'TERM'
  | 'SURFACE' | 'EXPECTED_MOVE' | 'EXPOSURE' | 'FLOW' | 'CROWD' | 'EVENTS'
  | 'HISTORICAL_CONTEXT' | 'STRUCTURAL_ECONOMICS';

export type ThetaOptionomicsDestination =
  | 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_RECOVERY' | 'THETA_CC'
  | 'THETA_DEFINED_RISK' | 'MANAGEMENT' | 'R6_RESEARCH';

/** Research/shadow routing governance only. This allowlist cannot authorize
 * a Paper action and is consumed by the strategy-quality shadow diagnostic. */
export const optionomicsFeatureDestinationAuthority = {
  authority: 'RESEARCH_SHADOW_ONLY',
  brokerAuthority: false,
} as const;

export const optionomicsFeatureDestinationMap: Readonly<Record<ThetaOptionomicsDestination, readonly OptionomicsFeatureFamily[]>> = {
  THETA_CONVENTIONAL: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','VOLATILITY','SKEW','TERM','SURFACE','EXPECTED_MOVE','EXPOSURE','FLOW','EVENTS','HISTORICAL_CONTEXT','STRUCTURAL_ECONOMICS'],
  THETA_HOLD_STRIKE: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','EXPECTED_MOVE','EXPOSURE','FLOW','EVENTS','STRUCTURAL_ECONOMICS'],
  THETA_RECOVERY: ['QUOTE','VOLATILITY','TERM','SURFACE','FLOW','EVENTS','HISTORICAL_CONTEXT','STRUCTURAL_ECONOMICS'],
  THETA_CC: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','VOLATILITY','SKEW','TERM','SURFACE','EXPECTED_MOVE','FLOW','EVENTS','STRUCTURAL_ECONOMICS'],
  THETA_DEFINED_RISK: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','VOLATILITY','SKEW','TERM','SURFACE','EXPECTED_MOVE','STRUCTURAL_ECONOMICS'],
  MANAGEMENT: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','VOLATILITY','SKEW','TERM','SURFACE','EXPECTED_MOVE','EXPOSURE','FLOW','EVENTS','STRUCTURAL_ECONOMICS'],
  R6_RESEARCH: ['CONTRACT','QUOTE','GREEKS','LIQUIDITY','VOLATILITY','SKEW','TERM','SURFACE','EXPECTED_MOVE','EXPOSURE','FLOW','CROWD','EVENTS','HISTORICAL_CONTEXT','STRUCTURAL_ECONOMICS'],
};

export function optionomicsFamiliesFor(destination: ThetaOptionomicsDestination): readonly OptionomicsFeatureFamily[] {
  return optionomicsFeatureDestinationMap[destination];
}
