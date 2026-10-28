import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import {
  VideoView,
  useVideoPlayer,
  type VideoRuntimeError,
} from 'react-native-video';

export interface RemoteVideoPlayerProps {
  /** 远端视频地址(COS 预签名直链等) */
  uri: string;
  /** 是否显示原生控制条(进度/播放暂停),默认 true */
  controls?: boolean;
  /** 播放失败回调(编码不支持、URL 失效等) */
  onError?: (message: string) => void;
}

/**
 * 远端视频播放器(spike:react-native-video v7 beta 集成验证)。
 *
 * v7 为 player/view 分离架构:useVideoPlayer 持有播放状态,
 * VideoView 是 Fabric(Nitro)原生视图,负责渲染与手势。
 */
export function RemoteVideoPlayer({
  uri,
  controls = true,
  onError,
}: RemoteVideoPlayerProps): React.JSX.Element {
  const player = useVideoPlayer({ uri });

  useEffect(() => {
    const onErrorSub = player.addEventListener('onError', (e: VideoRuntimeError) => {
      onError?.(e.message);
    });
    const onStatusSub = player.addEventListener('onStatusChange', status => {
      if (status === 'error') {
        onError?.('player entered error state');
      }
    });
    return () => {
      onErrorSub.remove();
      onStatusSub.remove();
    };
  }, [player, onError]);

  return (
    <VideoView
      player={player}
      style={styles.fill}
      controls={controls}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%', height: '100%' },
});
