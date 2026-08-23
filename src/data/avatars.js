// 预设头像库：从第三方免费源抓取的无版权真实图片
// 1-50: picsum.photos 真实照片（风景/人物/物体）
// 51-100: loliapi / 栗次元 / 派次元 / dmoe 动漫头像
const AVATARS = [
  { id: 'avatar-001', url: '/avatars/avatar-001.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-002', url: '/avatars/avatar-002.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-003', url: '/avatars/avatar-003.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-004', url: '/avatars/avatar-004.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-005', url: '/avatars/avatar-005.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-006', url: '/avatars/avatar-006.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-007', url: '/avatars/avatar-007.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-008', url: '/avatars/avatar-008.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-009', url: '/avatars/avatar-009.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-010', url: '/avatars/avatar-010.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-011', url: '/avatars/avatar-011.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-012', url: '/avatars/avatar-012.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-013', url: '/avatars/avatar-013.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-014', url: '/avatars/avatar-014.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-015', url: '/avatars/avatar-015.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-016', url: '/avatars/avatar-016.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-017', url: '/avatars/avatar-017.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-018', url: '/avatars/avatar-018.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-019', url: '/avatars/avatar-019.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-020', url: '/avatars/avatar-020.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-021', url: '/avatars/avatar-021.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-022', url: '/avatars/avatar-022.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-023', url: '/avatars/avatar-023.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-024', url: '/avatars/avatar-024.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-025', url: '/avatars/avatar-025.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-026', url: '/avatars/avatar-026.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-027', url: '/avatars/avatar-027.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-028', url: '/avatars/avatar-028.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-029', url: '/avatars/avatar-029.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-030', url: '/avatars/avatar-030.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-031', url: '/avatars/avatar-031.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-032', url: '/avatars/avatar-032.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-033', url: '/avatars/avatar-033.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-034', url: '/avatars/avatar-034.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-035', url: '/avatars/avatar-035.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-036', url: '/avatars/avatar-036.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-037', url: '/avatars/avatar-037.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-038', url: '/avatars/avatar-038.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-039', url: '/avatars/avatar-039.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-040', url: '/avatars/avatar-040.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-041', url: '/avatars/avatar-041.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-042', url: '/avatars/avatar-042.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-043', url: '/avatars/avatar-043.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-044', url: '/avatars/avatar-044.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-045', url: '/avatars/avatar-045.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-046', url: '/avatars/avatar-046.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-047', url: '/avatars/avatar-047.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-048', url: '/avatars/avatar-048.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-049', url: '/avatars/avatar-049.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-050', url: '/avatars/avatar-050.jpg', category: '照片', style: '真实照片' },
  { id: 'avatar-051', url: '/avatars/avatar-051.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-052', url: '/avatars/avatar-052.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-053', url: '/avatars/avatar-053.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-054', url: '/avatars/avatar-054.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-055', url: '/avatars/avatar-055.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-056', url: '/avatars/avatar-056.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-057', url: '/avatars/avatar-057.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-058', url: '/avatars/avatar-058.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-059', url: '/avatars/avatar-059.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-060', url: '/avatars/avatar-060.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-061', url: '/avatars/avatar-061.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-062', url: '/avatars/avatar-062.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-063', url: '/avatars/avatar-063.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-064', url: '/avatars/avatar-064.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-065', url: '/avatars/avatar-065.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-066', url: '/avatars/avatar-066.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-067', url: '/avatars/avatar-067.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-068', url: '/avatars/avatar-068.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-069', url: '/avatars/avatar-069.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-070', url: '/avatars/avatar-070.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-071', url: '/avatars/avatar-071.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-072', url: '/avatars/avatar-072.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-073', url: '/avatars/avatar-073.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-074', url: '/avatars/avatar-074.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-075', url: '/avatars/avatar-075.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-076', url: '/avatars/avatar-076.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-077', url: '/avatars/avatar-077.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-078', url: '/avatars/avatar-078.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-079', url: '/avatars/avatar-079.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-080', url: '/avatars/avatar-080.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-081', url: '/avatars/avatar-081.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-082', url: '/avatars/avatar-082.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-083', url: '/avatars/avatar-083.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-084', url: '/avatars/avatar-084.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-085', url: '/avatars/avatar-085.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-086', url: '/avatars/avatar-086.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-087', url: '/avatars/avatar-087.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-088', url: '/avatars/avatar-088.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-089', url: '/avatars/avatar-089.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-090', url: '/avatars/avatar-090.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-091', url: '/avatars/avatar-091.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-092', url: '/avatars/avatar-092.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-093', url: '/avatars/avatar-093.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-094', url: '/avatars/avatar-094.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-095', url: '/avatars/avatar-095.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-096', url: '/avatars/avatar-096.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-097', url: '/avatars/avatar-097.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-098', url: '/avatars/avatar-098.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-099', url: '/avatars/avatar-099.jpg', category: '动漫', style: '动漫' },
  { id: 'avatar-100', url: '/avatars/avatar-100.jpg', category: '动漫', style: '动漫' },
]

export const AVATAR_CATEGORIES = ['全部', '照片', '动漫']

// 随机取 n 个不重复头像 URL（池不足时循环补充）
export function randomAvatars(n) {
  const pool = [...AVATARS]
  const out = []
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) pool.push(...AVATARS)
    const idx = Math.floor(Math.random() * pool.length)
    out.push(pool.splice(idx, 1)[0].url)
  }
  return out
}

export function randomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)].url
}

// 按名字列表生成默认成员，并随机分配不重复的头像库头像
export function defaultMembers(names) {
  const avatars = randomAvatars(names.length)
  return names.map((name, i) => ({ name, avatar: avatars[i] }))
}

export default AVATARS