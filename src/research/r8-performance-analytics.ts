export const r8PerformanceAnalyticsVersion='theta-r8-performance-analytics-v2' as const;

export interface R8StrategyLineage {
  readonly strategyVersion:string; readonly policyVersion:string; readonly riskVersion:string;
  readonly modelVersion:string; readonly featureVersion:string; readonly buildSha:string;
  readonly fusionSnapshotId:string; readonly reasonCodes:readonly string[];
}
export interface R8EpisodeEvidence {
  readonly episodeId:string; readonly lineage:R8StrategyLineage;
  readonly navStart:number|null; readonly navEnd:number|null;
  readonly realizedPnl:number|null; readonly unrealizedPnl:number|null; readonly legPnl:number|null;
  readonly managedEpisodePnl:number|null; readonly wholeChainPnl:number|null;
  readonly premiumCollected:number|null; readonly stockPnl:number|null; readonly feesAndCosts:number|null;
  readonly tca:number|null; readonly mfe:number|null; readonly mae:number|null; readonly capitalDays:number|null;
  readonly assigned:boolean|null; readonly recoveryDurationDays:number|null;
  readonly coveredCallContribution:number|null; readonly calledAway:boolean|null;
}
export interface R8EquityPoint { readonly at:string; readonly equity:number|null; }
export interface R8WinRateInterval {
  readonly lower:number; readonly upper:number; readonly confidenceLevel:0.95;
  readonly sampleN:number; readonly method:'WILSON_SCORE';
  readonly state:'EFFECTIVE_N_ADJUSTED'|'RAW_EPISODE_COUNT_ONLY';
}
export interface R8PerformanceOptions {
  /** Dependence-adjusted count supplied by the governed dataset builder. Null
   * means only a raw-episode interval can be reported. */
  readonly effectiveIndependentN?:number|null;
  readonly expectedShortfallAlpha?:number;
}

export interface R8PerformanceReceipt {
  readonly version:typeof r8PerformanceAnalyticsVersion; readonly episodeCount:number; readonly resolvedEpisodeCount:number;
  readonly unknownEpisodeCount:number; readonly navChange:number|null; readonly realizedPnl:number|null;
  readonly unrealizedPnl:number|null; readonly legPnl:number|null; readonly managedEpisodePnl:number|null;
  readonly wholeChainPnl:number|null; readonly premiumCollected:number|null; readonly stockPnl:number|null;
  readonly feesAndCosts:number|null; readonly tca:number|null; readonly meanMfe:number|null; readonly meanMae:number|null;
  readonly maxDrawdown:number|null; readonly capitalDays:number|null; readonly returnPerCapitalDay:number|null;
  readonly winRate:number|null; readonly winRateInterval95:R8WinRateInterval|null;
  readonly effectiveIndependentN:number|null; readonly expectancy:number|null;
  readonly profitFactor:number|null; readonly payoffRatio:number|null;
  readonly averageWin:number|null; readonly averageLoss:number|null;
  readonly expectedShortfall:number|null; readonly expectedShortfallAlpha:number;
  readonly assignmentRate:number|null; readonly medianRecoveryDurationDays:number|null;
  readonly coveredCallContribution:number|null; readonly callAwayRate:number|null; readonly unknownFields:readonly string[];
}

const finite=(value:number|null):value is number=>value!==null&&Number.isFinite(value);
const strictSum=(values:readonly (number|null)[]):number|null=>values.length>0&&values.every(finite)
  ?values.reduce<number>((sum,value)=>sum+(value as number),0):null;
const mean=(values:readonly (number|null)[]):number|null=>{
  const sum=strictSum(values);
  return sum===null?null:sum/values.length;
};
const ratio=(numerator:number|null,denominator:number|null):number|null=>finite(numerator)&&finite(denominator)&&denominator!==0?numerator/denominator:null;
const rate=(values:readonly (boolean|null)[]):number|null=>values.length>0&&values.every((value)=>value!==null)
  ?values.filter(Boolean).length/values.length:null;
function wilsonInterval(successRate:number,sampleN:number,state:R8WinRateInterval['state']):R8WinRateInterval {
  const z=1.959963984540054,denominator=1+(z*z)/sampleN;
  const center=(successRate+(z*z)/(2*sampleN))/denominator;
  const margin=(z/denominator)*Math.sqrt((successRate*(1-successRate)/sampleN)+(z*z)/(4*sampleN*sampleN));
  return {lower:Math.max(0,center-margin),upper:Math.min(1,center+margin),confidenceLevel:0.95,
    sampleN,method:'WILSON_SCORE',state};
}
function median(values:readonly (number|null)[]):number|null {
  if(values.length===0||!values.every(finite))return null;
  const sorted=(values as readonly number[]).slice().sort((left,right)=>left-right),middle=Math.floor(sorted.length/2);
  return sorted.length%2===1?sorted[middle]??null:((sorted[middle-1]??0)+(sorted[middle]??0))/2;
}
function drawdown(points:readonly R8EquityPoint[]):number|null {
  if(points.length===0||points.some((point)=>!finite(point.equity)||!Number.isFinite(Date.parse(point.at))))return null;
  const sorted=points.slice().sort((left,right)=>Date.parse(left.at)-Date.parse(right.at));
  const first=sorted[0];
  if(first===undefined||!finite(first.equity))return null;
  let peak=first.equity,worst=0;
  for(const point of sorted){const equity=point.equity as number;peak=Math.max(peak,equity);worst=Math.min(worst,equity-peak);}
  return worst;
}
function fieldSum(episodes:readonly R8EpisodeEvidence[],field:keyof R8EpisodeEvidence):number|null {
  return strictSum(episodes.map((episode)=>episode[field] as number|null));
}

export function buildR8PerformanceReceipt(episodes:readonly R8EpisodeEvidence[],equity:readonly R8EquityPoint[],
  options:R8PerformanceOptions={}):R8PerformanceReceipt {
  const outcomes=episodes.map((episode)=>episode.wholeChainPnl),resolved=outcomes.filter(finite);
  const wins=resolved.filter((value)=>value>0),losses=resolved.filter((value)=>value<0);
  const effectiveIndependentN=options.effectiveIndependentN??null;
  if(effectiveIndependentN!==null&&(!Number.isInteger(effectiveIndependentN)||effectiveIndependentN<0||effectiveIndependentN>resolved.length)){
    throw new Error('R8_EFFECTIVE_N_INVALID');
  }
  const expectedShortfallAlpha=options.expectedShortfallAlpha??0.05;
  if(!Number.isFinite(expectedShortfallAlpha)||expectedShortfallAlpha<=0||expectedShortfallAlpha>1){
    throw new Error('R8_EXPECTED_SHORTFALL_ALPHA_INVALID');
  }
  const grossProfit=wins.reduce((sum,value)=>sum+value,0),grossLoss=Math.abs(losses.reduce((sum,value)=>sum+value,0));
  const capitalDays=fieldSum(episodes,'capitalDays'),wholeChainPnl=fieldSum(episodes,'wholeChainPnl');
  const orderedEquity=equity.slice().sort((left,right)=>Date.parse(left.at)-Date.parse(right.at));
  const firstEquity=orderedEquity[0]?.equity??null,lastEquity=orderedEquity.at(-1)?.equity??null;
  const navChange=orderedEquity.length<2||!finite(firstEquity)||!finite(lastEquity)?null:lastEquity-firstEquity;
  const assigned=episodes.filter((episode)=>episode.assigned===true);
  const winRate=resolved.length>0?wins.length/resolved.length:null;
  const intervalN=effectiveIndependentN!==null&&effectiveIndependentN>0?effectiveIndependentN:resolved.length;
  const winRateInterval95=winRate===null||intervalN===0?null:wilsonInterval(winRate,intervalN,
    effectiveIndependentN!==null?'EFFECTIVE_N_ADJUSTED':'RAW_EPISODE_COUNT_ONLY');
  const averageWin=wins.length>0?wins.reduce((sum,value)=>sum+value,0)/wins.length:null;
  const averageLoss=losses.length>0?losses.reduce((sum,value)=>sum+value,0)/losses.length:null;
  const payoffRatio=averageWin===null||averageLoss===null||averageLoss===0?null:averageWin/Math.abs(averageLoss);
  const expectancy=resolved.length>0?resolved.reduce((sum,value)=>sum+value,0)/resolved.length:null;
  const sortedOutcomes=resolved.slice().sort((left,right)=>left-right);
  const tailCount=sortedOutcomes.length===0?0:Math.max(1,Math.ceil(sortedOutcomes.length*expectedShortfallAlpha));
  const expectedShortfall=tailCount===0?null:sortedOutcomes.slice(0,tailCount).reduce((sum,value)=>sum+value,0)/tailCount;
  const metrics={
    navChange,realizedPnl:fieldSum(episodes,'realizedPnl'),unrealizedPnl:fieldSum(episodes,'unrealizedPnl'),legPnl:fieldSum(episodes,'legPnl'),
    managedEpisodePnl:fieldSum(episodes,'managedEpisodePnl'),wholeChainPnl,premiumCollected:fieldSum(episodes,'premiumCollected'),
    stockPnl:fieldSum(episodes,'stockPnl'),feesAndCosts:fieldSum(episodes,'feesAndCosts'),tca:fieldSum(episodes,'tca'),
    meanMfe:mean(episodes.map((episode)=>episode.mfe)),meanMae:mean(episodes.map((episode)=>episode.mae)),maxDrawdown:drawdown(equity),capitalDays,
    returnPerCapitalDay:ratio(wholeChainPnl,capitalDays),winRate,winRateInterval95,effectiveIndependentN,expectancy,
    profitFactor:losses.length>0?grossProfit/grossLoss:null,payoffRatio,averageWin,averageLoss,
    expectedShortfall,expectedShortfallAlpha,
    assignmentRate:rate(episodes.map((episode)=>episode.assigned)),
    medianRecoveryDurationDays:assigned.length>0?median(assigned.map((episode)=>episode.recoveryDurationDays)):null,
    coveredCallContribution:fieldSum(episodes,'coveredCallContribution'),callAwayRate:rate(assigned.map((episode)=>episode.calledAway)),
  };
  const unknownFields=Object.entries(metrics).filter(([,value])=>value===null).map(([key])=>key);
  return {version:r8PerformanceAnalyticsVersion,episodeCount:episodes.length,resolvedEpisodeCount:resolved.length,
    unknownEpisodeCount:episodes.length-resolved.length,...metrics,unknownFields};
}

export function buildR8StrategyAttribution(episodes:readonly R8EpisodeEvidence[],equityByLineage:Readonly<Record<string,readonly R8EquityPoint[]>>={}):Readonly<Record<string,R8PerformanceReceipt>> {
  const groups=new Map<string,R8EpisodeEvidence[]>();
  for(const episode of episodes){
    const lineage=episode.lineage;
    const key=[lineage.strategyVersion,lineage.policyVersion,lineage.riskVersion,lineage.modelVersion,lineage.featureVersion,lineage.buildSha].join('|');
    groups.set(key,[...(groups.get(key)??[]),episode]);
  }
  return Object.fromEntries([...groups.entries()].sort(([left],[right])=>left.localeCompare(right))
    .map(([key,items])=>[key,buildR8PerformanceReceipt(items,equityByLineage[key]??[])]));
}

export type R8DefectClass='ENTRY_DEFECT'|'CONTRACT_SELECTION_DEFECT'|'SIZING_DEFECT'|'EXECUTION_DEFECT'|'MANAGEMENT_DEFECT'|
  'ROLL_DEFECT'|'ASSIGNMENT_DEFECT'|'RECOVERY_DEFECT'|'CC_DEFECT'|'ACCOUNTING_DEFECT'|'PROVIDER_DEFECT'|
  'INFRASTRUCTURE_DEFECT'|'ORDINARY_MARKET_VARIANCE';

export function classifyR8Defect(input:{confirmedDefect:R8DefectClass|null;ordinaryMarketVarianceConfirmed:boolean}):R8DefectClass|null {
  if(input.confirmedDefect!==null)return input.confirmedDefect;
  return input.ordinaryMarketVarianceConfirmed?'ORDINARY_MARKET_VARIANCE':null;
}
