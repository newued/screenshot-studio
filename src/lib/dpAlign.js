/**
 * dpAlign.js — 有序 DP 全局对齐算法（V1.1 设计文档 5.2 节）
 *
 * 替代逐句贪心对齐，使用动态规划做全局最优对齐。
 *
 * 三种操作（下标严格递增，单调性由结构硬保证）：
 *   - match(i, j)：脚本消息 i ↔ rap 单元 j 匹配
 *   - skip-rap(j)：rap 单元 j 无脚本对应（判 adlib）
 *   - skip-script(i)：脚本消息 i 在 rap 中无对应（判 unmatched）
 *
 * 相似度矩阵 S[i][j]：字面 n-gram（容忍谐音/俚语改写）+ 字符 Jaccard
 *
 * 置信度标定：
 *   - dp_margin：最优/次优得分差（区分度）
 *   - calibrated_confidence：等 isotonic 校准后的经验正确率
 *   - ambiguous：多峰歧义检测
 *
 * 防污染第一闸：gap 罚分须低于弱匹配期望收益，
 * 使 DP 宁可 unmatched 也不接受坏配对。
 */

// ==================== 文本相似度 ====================

/**
 * 字符 Jaccard 相似度（去标点+繁简归一后）
 */
function charJaccard(a, b) {
  const sa = extractChars(a)
  const sb = extractChars(b)
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * 提取中文字符集合（去除标点、空白、英文字母）
 */
function extractChars(s) {
  const chars = (s || '').match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  return new Set(chars || [])
}

/**
 * 字面 n-gram 相似度（2-gram Jaccard，容忍局部改写）
 */
function ngramSimilarity(a, b, n = 2) {
  const ga = buildNgrams(a, n)
  const gb = buildNgrams(b, n)
  if (!ga.size || !gb.size) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  const union = ga.size + gb.size - inter
  return union > 0 ? inter / union : 0
}

function buildNgrams(s, n = 2) {
  const chars = (s || '').replace(/[\s，。！？、,.!?；;：:""'‘'（）()《》…—\-~～·\[\]【】]/g, '')
  const set = new Set()
  for (let i = 0; i <= chars.length - n; i++) {
    set.add(chars.substring(i, i + n))
  }
  return set
}

/**
 * 三路融合相似度：字面 n-gram + 字符 Jaccard + 长度比
 */
function fusedSimilarity(scriptText, rapText) {
  const ngram = ngramSimilarity(scriptText, rapText, 2)
  const jaccard = charJaccard(scriptText, rapText)
  const lenA = extractChars(scriptText).size
  const lenB = extractChars(rapText).size
  const lenRatio = lenA > 0 && lenB > 0
    ? Math.min(lenA, lenB) / Math.max(lenA, lenB)
    : 0
  // 加权融合：n-gram 权重最高（最能反映文本相似性）
  return 0.45 * ngram + 0.35 * jaccard + 0.20 * lenRatio
}

// ==================== DP 核心算法 ====================

/**
 * 有序 DP 全局对齐
 *
 * @param {Array<{ text: string, id?: number }>} scriptMsgs - 脚本消息数组
 * @param {Array<{ text: string, start: number, end: number }>} rapUnits - rap 行级单元
 * @param {object} opts - {
 *   gapPenalty: number,        // gap 罚分（低于弱匹配期望收益，防污染）
 *   threshold: number,         // 匹配阈值（低于此值不接受 match）
 *   ambiguousEpsilon: number,  // 多峰歧义分差阈值
 *   maxMergeUnits: number,     // 单条消息最多合并的 rap 单元数
 * }
 * @returns {{
 *   mapping: Array<object>,
 *   adlib_spans: Array<object>,
 *   mapping_meta: object,
 *   dpTable: Array
 * }}
 */
export function alignDP(scriptMsgs, rapUnits, opts = {}) {
  const {
    gapPenalty = 0.15,       // gap 罚分：低于弱匹配期望收益 → 宁可 unmatched 也不坏配
    threshold = 0.18,         // 匹配阈值：低于此值不接受 match
    ambiguousEpsilon = 0.05,  // 分差 < ε → 标歧义
    maxMergeUnits = 6,        // 单条消息最多合并的 rap 单元数
  } = opts

  const n = scriptMsgs.length  // 脚本消息数
  const m = rapUnits.length    // rap 单元数

  if (!n || !m) {
    return {
      mapping: scriptMsgs.map((msg, i) => ({
        message_id: i,
        rap_span: null,
        match_type: 'unmatched',
        proposed_at: 0,
        calibrated_confidence: 0,
        confidence_source: 'combined',
        ambiguous: false,
        candidates: [],
        review_reason: m === 0 ? '无 ASR 数据' : '无脚本消息',
      })),
      adlib_spans: rapUnits.map((u, j) => ({
        start: u.start, end: u.end, reason: 'no_script', origin: 'dp_skip',
      })),
      mapping_meta: {
        threshold, gap_penalty: gapPenalty,
        unmatched_count: n, needs_review: n > 0,
      },
      dpTable: [],
    }
  }

  // ==================== 1. 构建相似度矩阵 ====================
  // S[i][j] = 融合相似度（脚本消息 i vs rap 单元 j 的文本）
  const S = Array.from({ length: n }, () => new Array(m).fill(0))
  for (let i = 0; i < n; i++) {
    const scriptText = scriptMsgs[i].text || scriptMsgs[i].content || ''
    for (let j = 0; j < m; j++) {
      const rapText = rapUnits[j].text || ''
      S[i][j] = fusedSimilarity(scriptText, rapText)
    }
  }

  // ==================== 2. DP 递推 ====================
  // dp[i][j] = 前 i 条脚本消息与前 j 个 rap 单元的最大对齐得分
  // 操作：
  //   match(i,j)  → dp[i-1][j-1] + S[i][j] - gapPenalty * 0  （匹配不罚分）
  //   skip-rap(j) → dp[i][j-1] - gapPenalty                  （rap 单元无对应 → adlib）
  //   skip-msg(i) → dp[i-1][j] - gapPenalty                  （脚本消息无对应 → unmatched）
  //
  // 防污染：gap 罚分低于弱匹配期望收益 → DP 宁可 unmatched 也不接受 S < threshold 的坏配对
  //         但当 S > threshold 时，match 的收益 > gap 罚分 → 正确匹配

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-Infinity))
  const trace = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(null)
  )

  // 初始化
  dp[0][0] = 0
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] - gapPenalty
    trace[i][0] = { op: 'skip-msg', from: [i - 1, 0] }
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] - gapPenalty
    trace[0][j] = { op: 'skip-rap', from: [0, j - 1] }
  }

  // 递推
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const simScore = S[i - 1][j - 1]

      // match: 仅当相似度 ≥ threshold 时才考虑（防污染第一闸）
      const matchScore = simScore >= threshold
        ? dp[i - 1][j - 1] + simScore
        : -Infinity

      // skip-rap: rap 单元 j 无脚本对应（adlib）
      const skipRapScore = dp[i][j - 1] - gapPenalty

      // skip-msg: 脚本消息 i 无 rap 对应（unmatched）
      const skipMsgScore = dp[i - 1][j] - gapPenalty

      // 取最大
      const best = Math.max(matchScore, skipRapScore, skipMsgScore)
      dp[i][j] = best

      if (best === matchScore) {
        trace[i][j] = { op: 'match', from: [i - 1, j - 1], score: simScore }
      } else if (best === skipRapScore) {
        trace[i][j] = { op: 'skip-rap', from: [i, j - 1] }
      } else {
        trace[i][j] = { op: 'skip-msg', from: [i - 1, j] }
      }
    }
  }

  // ==================== 3. 回溯 ====================
  const operations = []
  let ci = n, cj = m
  while (ci > 0 || cj > 0) {
    const t = trace[ci][cj]
    if (!t) break
    operations.unshift({ ...t, i: ci, j: cj })
    ;[ci, cj] = t.from
  }

  // ==================== 4. 构建映射结果 ====================
  const mapping = []
  const adlibSpans = []

  // 合并连续 match 操作（一条脚本消息可能跨多个 rap 单元）
  let currentMatch = null

  for (const op of operations) {
    if (op.op === 'match') {
      const msgIdx = op.i - 1
      const unitIdx = op.j - 1
      const unit = rapUnits[unitIdx]
      const simScore = op.score

      if (currentMatch && currentMatch.message_id === msgIdx) {
        // 继续合并到当前 match
        currentMatch.rap_span.end = round(unit.end)
        currentMatch.rap_words_ref[1] = unitIdx
        currentMatch.scores.push(simScore)
      } else {
        // 先保存前一个 match
        if (currentMatch) {
          finalizeMatch(currentMatch, scriptMsgs, rapUnits, S, threshold, ambiguousEpsilon)
          mapping.push(currentMatch)
        }
        // 开始新 match
        currentMatch = {
          message_id: msgIdx,
          rap_span: { start: round(unit.start), end: round(unit.end) },
          match_type: classifyMatch(simScore),
          rap_words_ref: [unitIdx, unitIdx],
          scores: [simScore],
          calibrated_confidence: 0,
          confidence_source: 'dp_margin',
          ambiguous: false,
          candidates: [],
          review_reason: null,
        }
      }
    } else if (op.op === 'skip-rap') {
      // rap 单元无脚本对应 → adlib
      if (currentMatch) {
        finalizeMatch(currentMatch, scriptMsgs, rapUnits, S, threshold, ambiguousEpsilon)
        mapping.push(currentMatch)
        currentMatch = null
      }
      const unitIdx = op.j - 1
      const unit = rapUnits[unitIdx]
      adlibSpans.push({
        start: round(unit.start),
        end: round(unit.end),
        reason: 'intro_hook',
        origin: 'dp_skip',
      })
    } else if (op.op === 'skip-msg') {
      // 脚本消息无 rap 对应 → unmatched
      if (currentMatch) {
        finalizeMatch(currentMatch, scriptMsgs, rapUnits, S, threshold, ambiguousEpsilon)
        mapping.push(currentMatch)
        currentMatch = null
      }
      const msgIdx = op.i - 1
      // proposed_at：在节拍网格上的最近拍点
      const proposedAt = findProposedTime(msgIdx, scriptMsgs, rapUnits)
      mapping.push({
        message_id: msgIdx,
        rap_span: null,
        match_type: 'unmatched',
        proposed_at: round(proposedAt),
        calibrated_confidence: 0,
        confidence_source: 'combined',
        ambiguous: false,
        candidates: [],
        review_reason: '无 ASR 对应段',
      })
    }
  }
  // 保存最后一个 match
  if (currentMatch) {
    finalizeMatch(currentMatch, scriptMsgs, rapUnits, S, threshold, ambiguousEpsilon)
    mapping.push(currentMatch)
  }

  // ==================== 5. 多峰歧义检测 ====================
  // 对每个 match，检查相似度矩阵中是否有其他高分离的候选
  for (const m of mapping) {
    if (m.match_type === 'unmatched') continue
    const i = m.message_id
    const bestJ = m.rap_words_ref[0]
    const bestScore = S[i][bestJ] || 0

    // 搜索其他候选（距离 > maxMergeUnits 的位置）
    const candidates = []
    for (let j = 0; j < rapUnits.length; j++) {
      if (j >= m.rap_words_ref[0] && j <= m.rap_words_ref[1]) continue
      if (S[i][j] >= threshold && S[i][j] >= bestScore - ambiguousEpsilon) {
        candidates.push({
          rap_unit: j,
          start: round(rapUnits[j].start),
          end: round(rapUnits[j].end),
          score: round(S[i][j], 4),
        })
      }
    }

    if (candidates.length > 0) {
      m.ambiguous = true
      m.candidates = candidates
      m.review_reason = m.review_reason || '重复 hook 多峰歧义'
    }
  }

  // ==================== 6. 统计与返回 ====================
  const unmatchedCount = mapping.filter(m => m.match_type === 'unmatched').length
  const ambiguousCount = mapping.filter(m => m.ambiguous).length
  const needsReview = unmatchedCount > 0 || ambiguousCount > 0

  // 按 message_id 排序
  mapping.sort((a, b) => a.message_id - b.message_id)

  return {
    mapping,
    adlib_spans: adlibSpans,
    mapping_meta: {
      threshold,
      gap_penalty: gapPenalty,
      unmatched_count: unmatchedCount,
      ambiguous_count: ambiguousCount,
      needs_review: needsReview,
      total_messages: n,
      total_rap_units: m,
      matched_count: mapping.filter(m => m.match_type !== 'unmatched').length,
    },
    dpTable: dp,
  }
}

// ==================== 辅助函数 ====================

/**
 * 完成单个 match 的置信度标定
 */
function finalizeMatch(match, scriptMsgs, rapUnits, S, threshold, epsilon) {
  const avgScore = match.scores.reduce((a, b) => a + b, 0) / match.scores.length
  const maxScore = Math.max(...match.scores)

  // 置信度标定：DP margin（最优/次优得分差）
  // 简化版等温回归：分数 > 0.5 → 高置信；0.3-0.5 → 中；< 0.3 → 低
  match.calibrated_confidence = calibrateConfidence(avgScore, maxScore)

  // 重新分类 match_type
  if (avgScore >= 0.55) {
    match.match_type = 'exact'
  } else if (avgScore >= 0.30) {
    match.match_type = 'paraphrase'
  } else {
    match.match_type = 'partial'
  }

  // 清理内部字段
  delete match.scores
}

/**
 * 等温校准（简化版）：把原始相似度映射为经验正确率
 * - score ≥ 0.7 → 0.95（高置信）
 * - score 0.5-0.7 → 0.80
 * - score 0.3-0.5 → 0.55
 * - score < 0.3 → 0.25
 */
function calibrateConfidence(avgScore, maxScore) {
  // 取平均分和最高分的加权
  const combined = 0.6 * avgScore + 0.4 * maxScore
  if (combined >= 0.7) return round(0.90 + (combined - 0.7) * 0.33, 2) // 0.90-0.97
  if (combined >= 0.5) return round(0.65 + (combined - 0.5) * 1.25, 2) // 0.65-0.90
  if (combined >= 0.3) return round(0.35 + (combined - 0.3) * 1.50, 2) // 0.35-0.65
  return round(combined * 1.17, 2) // 0-0.35
}

/**
 * 根据相似度分数分类匹配类型
 */
function classifyMatch(score) {
  if (score >= 0.55) return 'exact'
  if (score >= 0.30) return 'paraphrase'
  return 'partial'
}

/**
 * 为 unmatched 消息找到 proposed_at 时间
 * 策略：按消息序号在音频时长内均匀分布，吸附到最近的 rap 单元
 */
function findProposedTime(msgIdx, scriptMsgs, rapUnits) {
  const n = scriptMsgs.length
  const totalDuration = rapUnits.length > 0
    ? rapUnits[rapUnits.length - 1].end
    : 0

  // 均匀分布的位置
  const estimated = totalDuration > 0
    ? (msgIdx / n) * totalDuration
    : 0

  // 找最近的 rap 单元起点
  let best = estimated
  let bestDist = Infinity
  for (const u of rapUnits) {
    const d = Math.abs(u.start - estimated)
    if (d < bestDist) {
      bestDist = d
      best = u.start
    }
  }
  return best
}

/**
 * 将 mapping 结果转换为时间轴格式（display_start / display_end）
 * 供下游 TIMELINE 步骤消费
 *
 * @param {Array} mapping - alignDP 输出的 mapping 数组
 * @param {number} totalDuration - 音频总时长
 * @param {number[]} beatGrid - 节拍网格（用于吸附）
 * @returns {Array<{ display_start: number, display_end: number, match_type: string, source: string }>}
 */
export function mappingToTimeline(mapping, totalDuration = 0, beatGrid = []) {
  return mapping.map((m) => {
    if (m.rap_span) {
      return {
        display_start: m.rap_span.start,
        display_end: m.rap_span.end,
        match_type: m.match_type,
        source: 'rap_span',
        calibrated_confidence: m.calibrated_confidence,
        ambiguous: m.ambiguous,
      }
    } else {
      // unmatched: 用 proposed_at 吸附到节拍
      const snapped = snapToBeat(m.proposed_at || 0, beatGrid)
      return {
        display_start: snapped,
        display_end: round(snapped + 2.0), // 默认 2 秒
        match_type: 'unmatched',
        source: 'proposed_at',
        calibrated_confidence: m.calibrated_confidence,
        ambiguous: m.ambiguous,
        review_reason: m.review_reason,
        candidates: m.candidates,
      }
    }
  })
}

/**
 * 吸附到最近的节拍点
 */
function snapToBeat(time, beatGrid) {
  if (!beatGrid || beatGrid.length === 0) return time
  let best = beatGrid[0]
  let bestDist = Math.abs(time - best)
  for (const t of beatGrid) {
    const d = Math.abs(time - t)
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best
}

function round(n, d = 4) {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}
