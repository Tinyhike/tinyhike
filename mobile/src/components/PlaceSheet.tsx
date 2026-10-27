import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { BasemapPlace } from '@/lib/basemap-place'
import { colors } from '@/lib/colors'

type Props = {
  place: BasemapPlace
  onClose: () => void
}

/** The tapped place, in a sheet at the bottom of the map. */
export function PlaceSheet({ place, onClose }: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
            {place.name}
          </Text>
          {place.category ? <Text style={styles.category}>{place.category}</Text> : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
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
    backgroundColor: colors.paper,
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
  name: { fontSize: 20, fontWeight: '700', color: colors.ink },
  category: { marginTop: 4, fontSize: 15, color: colors.inkSoft },
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
