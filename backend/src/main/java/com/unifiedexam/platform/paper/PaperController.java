package com.unifiedexam.platform.paper;

import jakarta.validation.Valid;
import com.unifiedexam.platform.security.PaperManagementAccessPolicy;
import com.unifiedexam.platform.security.SatAdminAccessPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Shared paper endpoints; exam-specific JSON remains owned by the registered exam type. */
@RestController
@RequestMapping("/api/admin")
public class PaperController {

    private final PaperService paperService;
    private final SatAdminAccessPolicy satAccess;
    private final PaperManagementAccessPolicy paperAccess;

    public PaperController(PaperService paperService,
                           SatAdminAccessPolicy satAccess,
                           PaperManagementAccessPolicy paperAccess) {
        this.paperService = paperService;
        this.satAccess = satAccess;
        this.paperAccess = paperAccess;
    }

    @GetMapping("/exam-types/{examTypeCode}/paper-groups")
    public List<PaperService.PaperGroupView> listGroups(@PathVariable String examTypeCode, Authentication authentication) {
        satAccess.requireAdminForType(examTypeCode, authentication);
        return paperService.listGroups(examTypeCode);
    }

    @PostMapping("/exam-types/{examTypeCode}/paper-groups")
    public PaperService.PaperGroupView createGroup(@PathVariable String examTypeCode,
                                                    @Valid @RequestBody PaperService.SaveGroupRequest request,
                                                    Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.createGroup(examTypeCode, request);
    }

    @PutMapping("/paper-groups/{groupId}")
    public PaperService.PaperGroupView updateGroup(@PathVariable long groupId,
                                                    @Valid @RequestBody PaperService.SaveGroupRequest request,
                                                    Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.updateGroup(groupId, request);
    }

    @DeleteMapping("/paper-groups/{groupId}")
    public void deleteGroup(@PathVariable long groupId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        paperService.deleteGroup(groupId);
    }

    @PutMapping("/exam-types/{examTypeCode}/paper-groups/order")
    public List<PaperService.PaperGroupView> reorderGroups(@PathVariable String examTypeCode,
            @Valid @RequestBody PaperService.ReorderGroupsRequest request, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.reorderGroups(examTypeCode, request);
    }

    @PutMapping("/workspaces/{workspaceCode}/paper-groups/order")
    public void reorderWorkspaceGroups(@PathVariable String workspaceCode,
            @Valid @RequestBody PaperService.ReorderWorkspaceGroupsRequest request, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        paperService.reorderWorkspaceGroups(workspaceCode, request);
    }

    @GetMapping("/exam-types/{examTypeCode}/papers")
    public List<PaperService.PaperSummary> listPapers(@PathVariable String examTypeCode, Authentication authentication) {
        satAccess.requireAdminForType(examTypeCode, authentication);
        return paperService.list(examTypeCode);
    }

    @PostMapping("/exam-types/{examTypeCode}/papers")
    public PaperService.PaperDetail createPaper(@PathVariable String examTypeCode,
                                                 @Valid @RequestBody PaperService.CreatePaperRequest request,
                                                 Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.create(examTypeCode, request, authentication.getName());
    }

    @GetMapping("/papers/{paperId}")
    public PaperService.PaperDetail getPaper(@PathVariable long paperId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.get(paperId);
    }

    @GetMapping("/papers/{paperId}/structure-stats")
    public PaperService.PaperStructureStats getPaperStructureStats(@PathVariable long paperId,
                                                                    Authentication authentication) {
        satAccess.requireAdminForPaper(paperId, authentication);
        return paperService.structureStats(paperId);
    }

    @GetMapping("/papers/{paperId}/delete-impact")
    public PaperService.PaperDeleteImpact getDeleteImpact(@PathVariable long paperId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.deleteImpact(paperId);
    }

    @DeleteMapping("/papers/{paperId}")
    public void deletePaper(@PathVariable long paperId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        paperService.delete(paperId);
    }

    @PatchMapping("/papers/{paperId}")
    public PaperService.PaperDetail updatePaper(@PathVariable long paperId,
                                                 @Valid @RequestBody PaperService.UpdatePaperRequest request,
                                                 Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.update(paperId, request);
    }

    @PatchMapping("/papers/{paperId}/group")
    public PaperService.PaperSummary movePaper(@PathVariable long paperId, @RequestBody MovePaperRequest request,
                                               Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.moveToGroup(paperId, request.paperGroupId());
    }

    @PatchMapping("/papers/{paperId}/archive")
    public PaperService.PaperSummary setPaperArchived(@PathVariable long paperId,
                                                       @RequestBody ArchivePaperRequest request,
                                                       Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.setArchived(paperId, request.archived());
    }

    @PostMapping("/papers/{paperId}/questions/import-from-exam")
    public List<PaperService.QuestionView> importQuestions(@PathVariable long paperId,
            @Valid @RequestBody PaperService.ImportQuestionsRequest request, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.importQuestions(paperId, request);
    }

    @PatchMapping("/papers/{paperId}/scoring-profile")
    public PaperService.PaperDetail updateScoringProfile(@PathVariable long paperId,
                                                          @RequestBody ScoringProfileRequest request,
                                                          Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.updateScoringProfile(paperId, request.scoringProfileCode());
    }

    @PutMapping("/papers/{paperId}/structure")
    public PaperService.PaperDetail savePaperStructure(@PathVariable long paperId,
                                                        @Valid @RequestBody PaperService.SaveStructureRequest request,
                                                        Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.saveStructureFromEditor(paperId, request);
    }

    @PutMapping("/papers/{paperId}/materials/content")
    public PaperService.PaperDetail updateMaterials(@PathVariable long paperId,
            @Valid @RequestBody List<PaperService.MaterialContentUpdate> materials, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.updateShsatMaterials(paperId, materials);
    }

    @PostMapping("/papers/{paperId}/versions")
    public PaperService.PaperDetail createVersion(@PathVariable long paperId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.createVersion(paperId, authentication.getName());
    }

    @PostMapping("/papers/{paperId}/seal")
    public PaperService.PaperDetail sealPaper(@PathVariable long paperId, Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        return paperService.seal(paperId);
    }

    public record ScoringProfileRequest(String scoringProfileCode) { }
    public record MovePaperRequest(Long paperGroupId) { }
    public record ArchivePaperRequest(boolean archived) { }
}
