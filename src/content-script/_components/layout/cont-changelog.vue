<template>
<changelog-modal :show="show" @update:show="$emit('update:show', $event)" />
</template>

<script>
import changelogModal from "@output-snippets/changelog-modal.vue";

export default {
  props: [ 'show' ],
  emits: [ 'update:show' ],
  components: { changelogModal },
}
</script>
