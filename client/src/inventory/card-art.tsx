import { useEffect, useRef, useState } from 'react';
import { CardAtlasSchema, type CardAtlas } from '../../../packages/contracts/src/card-atlas';
import { drawPlayerCard, loadCardPages } from '../cardSprites';
import { WebAssetScene } from '../assets';
import type { OwnedCardView } from '../../../packages/client-model/src/owned-lineup';
import styles from './inventory.module.css';
export interface CardArt {
  atlas: CardAtlas;
  images: Map<string, HTMLImageElement>;
}
export function useCardArt() {
  const [art, setArt] = useState<CardArt | null>(null);
  useEffect(() => {
    const resources = new WebAssetScene();
    let active = true;
    void resources
      .data('card.atlas')
      .then((value) => CardAtlasSchema.parse(value))
      .then(async (atlas) => ({ atlas, images: await loadCardPages(atlas, resources) }))
      .then((value) => {
        if (active) setArt(value);
      })
      .catch(() => {
        if (active) setArt(null);
      });
    return () => {
      active = false;
      resources.dispose();
    };
  }, []);
  return art;
}
export function CardArtView({ art, card, selected }: { art: CardArt; card: OwnedCardView; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = 160 * dpr;
    canvas.height = 224 * dpr;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(dpr, dpr);
    drawPlayerCard(
      context,
      art.atlas,
      art.images,
      card.playerDefId,
      card.status === 'disabled' ? 'disabled' : selected ? 'selected' : 'normal',
    );
  }, [art, card.playerDefId, card.status, selected]);
  return <canvas ref={ref} className={styles.art} aria-hidden="true" />;
}
