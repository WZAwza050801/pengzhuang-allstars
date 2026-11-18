import { FIELD_SKINS } from '../../shared/data';

/**
 * D11：大厅竞技场展示用原版 Q 版立体体育场图（orig_ui/stadium/Image_01–05），
 * 与对局俯视场地是两套资产，禁止共用。旧 Demo 与新 Web 壳共用此映射。
 */
export const ARENAS = [
  { stadium: 'Image_01', skin: 'scene_01', name: '社区联赛' },
  { stadium: 'Image_02', skin: 'scene_02', name: '地区联赛' },
  { stadium: 'Image_03', skin: 'scene_03', name: '甲级联赛' },
  { stadium: 'Image_04', skin: 'scene_04', name: '超级联赛' },
  { stadium: 'Image_05', skin: 'scene_05', name: '全明星联赛' },
].filter((a) => FIELD_SKINS.some((s) => s.id === a.skin));

export function stadiumImage(skinId: string | null): string {
  const arena = ARENAS.find((a) => a.skin === skinId) ?? ARENAS[0];
  return `/assets/orig_ui/stadium/${arena.stadium}.png`;
}