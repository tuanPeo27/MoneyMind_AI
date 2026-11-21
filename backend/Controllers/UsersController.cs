using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace backend.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public sealed class UsersController(IUserService userService, ICurrentUserService currentUser) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<UserResponse>> GetProfile(CancellationToken ct) =>
        Ok(await userService.GetProfileAsync(currentUser.RequiredUserId, ct));

    [HttpPut("me")]
    public async Task<ActionResult<UserResponse>> UpdateProfile(UpdateProfileRequest request, CancellationToken ct) =>
        Ok(await userService.UpdateProfileAsync(currentUser.RequiredUserId, request, ct));

    [HttpPut("me/password")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<MessageResponse>> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        await userService.ChangePasswordAsync(currentUser.RequiredUserId, request, ct);
        return Ok(new MessageResponse("Đổi mật khẩu thành công. Vui lòng đăng nhập lại trên các thiết bị."));
    }
}
