import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import { Celebration } from '../constants/types';
import { useReducedMotion } from '../utils/useReducedMotion';
import Icon from './Icon';

type Props = {
  celebration: Celebration;
  onClose: () => void;
};

export default function CelebrationOverlay({ celebration, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const cardOpacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const cardScale = useRef(new Animated.Value(reducedMotion ? 1 : 0.9)).current;
  const orbScale = useRef(new Animated.Value(reducedMotion ? 1 : 0.72)).current;

  useEffect(() => {
    if (reducedMotion) {
      cardOpacity.setValue(1);
      cardScale.setValue(1);
      orbScale.setValue(1);
      return;
    }
    cardOpacity.setValue(0);
    cardScale.setValue(0.9);
    orbScale.setValue(0.72);
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        tension: 150,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.spring(orbScale, {
        toValue: 1,
        tension: 170,
        friction: 9,
        useNativeDriver: true,
      }),
    ]).start();
  }, [celebration.title, reducedMotion, cardOpacity, cardScale, orbScale]);

  const bgColor =
    celebration.kind === 'badge'
      ? COLORS.yellow
      : celebration.kind === 'chest'
      ? COLORS.chestGold
      : COLORS.pink;

  const iconColor =
    celebration.kind === 'badge'
      ? COLORS.purple
      : celebration.kind === 'chest'
      ? COLORS.chestBrown
      : COLORS.white;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Confetti dots */}
        {Array.from({ length: 12 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.confetti,
              {
                left: `${8 + ((i * 19) % 84)}%` as any,
                top: `${12 + ((i * 13) % 28)}%` as any,
                backgroundColor: ['#f32c87', '#ffd640', '#7fcaa1', '#9b7bd2', '#f69c57'][i % 5],
                transform: [{ rotate: `${(i * 47) % 360}deg` }],
              },
            ]}
          />
        ))}

        <Animated.View
          style={[
            styles.card,
            {
              opacity: cardOpacity,
              transform: [{ scale: cardScale }],
            },
          ]}
        >
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
            <Icon name="x" size={18} color={COLORS.muted} />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.iconOrb,
              { backgroundColor: bgColor, transform: [{ scale: orbScale }] },
            ]}
          >
            <Icon name={celebration.iconName} size={36} color={iconColor} />
          </Animated.View>

          <Text style={styles.eyebrow}>{celebration.reward}</Text>
          <Text style={styles.title}>{celebration.title}</Text>
          <Text style={styles.detail}>{celebration.detail}</Text>

          <TouchableOpacity style={styles.button} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Keep the good energy</Text>
            <Icon name="sparkles" size={14} color={COLORS.white} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(41,16,76,0.46)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confetti: {
    position: 'absolute',
    width: 8,
    height: 14,
    borderRadius: 3,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    paddingTop: 36,
    paddingBottom: 28,
    paddingHorizontal: 28,
    borderRadius: RADIUS.xxl,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    shadowColor: '#dca8cf',
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  closeBtn: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0e7f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconOrb: {
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: COLORS.purple,
    marginBottom: 16,
    shadowColor: COLORS.yellow,
    shadowOpacity: 0.4,
    shadowOffset: { width: 4, height: 5 },
    elevation: 5,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.pink,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.purple,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  detail: {
    fontSize: 13,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 22,
    lineHeight: 19,
    maxWidth: 260,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: COLORS.pink,
    shadowColor: '#bf256b',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
  },
});
