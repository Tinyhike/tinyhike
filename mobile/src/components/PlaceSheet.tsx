import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { TapLookup } from '@/lib/basemap-place'
import { colors } from '@/theme'
import { t } from '@/lib/i18n'

type Props = {
  state: TapLookup
  onClose: () => void
}

/** The tapped place, in a sheet at the bottom of the map. */
export function PlaceSheet({ state, onClose }: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.row}>
        {state.kind === 'place' ? (
          <View style={styles.text}>
            {/* A nameless place (most playgrounds) is titled by its category. */}
            <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
              {state.place.name ?? state.place.category ?? t('sheet.untitled')}
            </Text>
            {state.place.name && state.place.category ? <Text style={styles.category}>{state.place.category}</Text> : null}
          </View>
        ) : (
          <View style={[styles.text, styles.status]} accessibilityLiveRegion="polite">
            <Text style={styles.message}>{t('tap.none')}</Text>
          </View>
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('sheet.close')}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  text: { flex: 1 },
  status: { minHeight: 24, justifyContent: 'center' },
  name: { fontSize: 20, fontWeight: '700', color: colors.ink },
  category: { marginTop: 4, fontSize: 15, color: colors.inkSoft },
  message: { flex: 1, fontSize: 15, color: colors.ink },
  close: {
    width: 44,
    height: 44,
    marginTop: -10,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  pressed: { backgroundColor: colors.pressed },
  closeText: { fontSize: 28, lineHeight: 30, color: colors.inkSoft },
})
