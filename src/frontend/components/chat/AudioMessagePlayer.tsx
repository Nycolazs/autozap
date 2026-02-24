import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import styles from '@/src/frontend/components/chat/chat.module.css';

type AudioMessagePlayerProps = {
  src: string;
  isOutgoing?: boolean;
};

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function AudioMessagePlayer({ src, isOutgoing = false }: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [positionSec, setPositionSec] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      setDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTimeUpdate = () => {
      setPositionSec(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setPositionSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [src]);

  const progressPercent = useMemo(() => {
    if (!durationSec || !Number.isFinite(durationSec)) return 0;
    return Math.max(0, Math.min(100, (positionSec / durationSec) * 100));
  }, [durationSec, positionSec]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      setIsLoading(true);
      if (!audio.paused) {
        audio.pause();
      } else {
        if (durationSec > 0 && audio.currentTime >= durationSec) {
          audio.currentTime = 0;
          setPositionSec(0);
        }
        await audio.play();
      }
    } catch (_) {
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [durationSec]);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !durationSec) return;
    const nextPercent = Number(event.target.value);
    const nextPosition = Math.max(0, Math.min(durationSec, (nextPercent / 100) * durationSec));
    audio.currentTime = nextPosition;
    setPositionSec(nextPosition);
  }, [durationSec]);

  const shownDuration = durationSec || positionSec;

  return (
    <div className={`${styles.audioPlayer} ${isOutgoing ? styles.audioPlayerOutgoing : ''}`}>
      <button
        type="button"
        className={`${styles.audioPlayButton} ${isOutgoing ? styles.audioPlayButtonOutgoing : ''}`}
        onClick={() => void togglePlayback()}
        aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {isLoading ? (
          <span className={styles.audioButtonSpinner} />
        ) : (
          <span className={!isPlaying ? styles.audioPlayIconShift : undefined}>{isPlaying ? '❚❚' : '▶'}</span>
        )}
      </button>

      <div className={styles.audioTrackWrap}>
        <input
          className={styles.audioTrackRange}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progressPercent}
          onChange={handleSeek}
          aria-label="Progresso do áudio"
        />
        <div className={styles.audioMetaRow}>
          <span className={styles.audioMetaIcon}>🎤</span>
          <span className={styles.audioMetaText}>{formatAudioTime(shownDuration)}</span>
        </div>
      </div>
    </div>
  );
}
